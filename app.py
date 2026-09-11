import os
import json
import math
import redis
from flask import Flask, request, jsonify, render_template
from google.oauth2 import id_token
from google.auth.transport import requests
from services.config_loader import load_configuration
from services.bonus_engine import calculate_bonus
from dotenv import load_dotenv
from flask_compress import Compress
from flask import send_from_directory

load_dotenv()

app = Flask(__name__)
Compress(app)

@app.route('/sw.js')
def serve_sw():
    # Serves the sw.js file from the static folder but routes it to the root URL
    return send_from_directory('static', 'sw.js', mimetype='application/javascript')

# Initialize Redis connection (Gracefully handles missing URL during local dev)
redis_url = os.environ.get('REDIS_URL', 'redis://localhost:6379')
# decode_responses=True ensures we get clean strings instead of byte objects
redis_client = redis.from_url(redis_url, decode_responses=True)

def get_cached_config(sheet_id):
    cache_key = f"upia_bonus_config_{sheet_id}"
    
    try:
        # 1. Try to fetch from Redis
        cached_data = redis_client.get(cache_key)
        if cached_data:
            print("DEBUG: Serving config from Redis Cache!")
            return json.loads(cached_data)
    except Exception as e:
        print(f"DEBUG: Redis Read Error (falling back to Google): {e}")

    # 2. Cache Miss: Fetch fresh data from Google Sheets
    print("DEBUG: Cache miss. Fetching fresh data from Google Sheets...")
    fresh_config = load_configuration(sheet_id)
    
    try:
        # 3. Save to Redis with a 4-hour (14400 seconds) expiration
        redis_client.setex(cache_key, 14400, json.dumps(fresh_config))
        print("DEBUG: Successfully saved fresh config to Redis.")
    except Exception as e:
        print(f"DEBUG: Redis Write Error: {e}")
        
    return fresh_config


# 1. Set the exact Sheet ID as the permanent fallback right here
app.config['SHEET_ID'] = os.environ.get('SHEET_ID', '1NXN8rBdusXSNQg3zbSNbxmPvb7vIiQ3vtq79lFcNi1o')
GOOGLE_CLIENT_ID = "85732911341-tfjnf14n13laa692di7ntici1d17b3pe.apps.googleusercontent.com"

try:
    # 2. Use the Redis Cache function to prevent Vercel Cold Starts from rate-limiting Google
    app.config['BONUS_CONFIG'] = get_cached_config(app.config['SHEET_ID'])
    app.config['CONFIG_STATUS'] = "Google Sheet Synced ✓"
except Exception as e:
    app.config['BONUS_CONFIG'] = None
    app.config['CONFIG_STATUS'] = f"Failed: {str(e)}"


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/overview')
def overview():
    return render_template('overview.html')


@app.route('/api/auth/google', methods=['POST'])
def auth_google():
    data = request.get_json()
    token = data.get('credential')

    try:
        idinfo = id_token.verify_oauth2_token(token, requests.Request(), GOOGLE_CLIENT_ID)
        email = idinfo['email'].lower()
        
        # Pull from Redis Cache
        sheet_id = app.config.get('SHEET_ID')
        bonus_config = get_cached_config(sheet_id)
        
        if bonus_config:
            staff_data = bonus_config.get('staff', {})
            performance_data = bonus_config.get('performance', {})
            management_data = bonus_config.get('management', {}) 

            print(f"DEBUG: Trying to log in with -> {email}")
            
            is_staff = email in staff_data
            is_mgmt = email in management_data
            
            if is_staff or is_mgmt:
                
                # 1. Build Base User Object
                if is_mgmt and not is_staff:
                    mgmt_user = dict(management_data[email])
                    user_info = {
                        "name": mgmt_user.get("name", email.split("@")[0].replace('.', ' ').title()),
                        "email": email,
                        "branch": mgmt_user.get("branch", "HQ"),
                        "type": mgmt_user.get("role", "Ops Manager"),
                        "id": mgmt_user.get("id", "MGT"),
                        "pairs": "0",
                        "is_ops": True
                    }
                else:
                    user_info = dict(staff_data[email])
                    user_info['is_ops'] = is_mgmt
                
                user_info['picture'] = idinfo.get('picture', '')
                user_info['performance'] = {}
                
                user_branch = str(user_info.get('branch', '')).strip().lower()
                emp_type = str(user_info.get('type', '')).strip().upper()
                
                # Assign Admin Role if applicable
                if is_mgmt and "ADMIN" in str(management_data[email].get('role', emp_type)).strip().upper():
                    user_info['type'] = "System Admin"
                    emp_type = "ADMIN"

                # 2. Skip Performance Calculation for Ops/Admins
                if not user_info.get('is_ops'):
                    is_bm = "BM" in emp_type or "MANAGER" in emp_type
                    
                    if is_bm:
                        branch_prefix = f"{user_branch}_"
                        agg_data = {}
                        
                        for key, metrics in performance_data.items():
                            if key.startswith(branch_prefix):
                                parts = key.split('_')
                                if len(parts) >= 3:
                                    month_code = parts[-1]
                                    
                                    if month_code not in agg_data:
                                        agg_data[month_code] = {
                                            "count": 0,
                                            "disb_target": 0.0, "disb_actual": 0.0, "disb_rate": 0.0,
                                            "ac_target": 0.0, "ac_actual": 0.0, "ac_rate": 0.0,
                                            "nc_target": 0.0, "nc_actual": 0.0, "nc_rate": 0.0,
                                            "overall_otc": 0.0, "dd7_rate": 0.0, "new_customer_otc": 0.0
                                        }
                                    
                                    m = agg_data[month_code]
                                    m["count"] += 1
                                    
                                    m["disb_target"] += metrics.get("disb_target", 0)
                                    m["disb_actual"] += metrics.get("disb_actual", 0)
                                    m["disb_rate"] += metrics.get("disb_rate", 0)
                                    m["ac_target"] += metrics.get("ac_target", 0)
                                    m["ac_actual"] += metrics.get("ac_actual", 0)
                                    m["ac_rate"] += metrics.get("ac_rate", 0)
                                    m["nc_target"] += metrics.get("nc_target", 0)
                                    m["nc_actual"] += metrics.get("nc_actual", 0)
                                    m["nc_rate"] += metrics.get("nc_rate", 0)
                                    m["overall_otc"] += metrics.get("overall_otc", 0)
                                    m["dd7_rate"] += metrics.get("dd7_rate", 0)
                                    m["new_customer_otc"] += metrics.get("new_customer_otc", 0)
                        
                        for month_code, agg in agg_data.items():
                            c = agg["count"]
                            if c > 0:
                                user_info['performance'][month_code] = {
                                    "disb_target": agg["disb_target"],
                                    "disb_actual": agg["disb_actual"],
                                    "disb_rate": agg["disb_rate"] / c,
                                    "ac_target": agg["ac_target"],
                                    "ac_actual": agg["ac_actual"],
                                    "ac_rate": agg["ac_rate"] / c,
                                    "nc_target": agg["nc_target"],
                                    "nc_actual": agg["nc_actual"],
                                    "nc_rate": agg["nc_rate"] / c,
                                    "overall_otc": agg["overall_otc"] / c,
                                    "dd7_rate": agg["dd7_rate"] / c,
                                    "new_customer_otc": agg["new_customer_otc"] / c
                                }
                    else:
                        user_pair_raw = str(user_info.get('pairs', '1')).strip().lower()
                        if user_pair_raw in ['1', '']: user_pair_raw = 'pair 1'
                        elif user_pair_raw == '2': user_pair_raw = 'pair 2'
                        elif user_pair_raw == '3': user_pair_raw = 'pair 3'
                            
                        prefix = f"{user_branch}_{user_pair_raw}_"
                        for key, metrics in performance_data.items():
                            if key.startswith(prefix):
                                parts = key.split('_')
                                month_code = parts[-1]
                                user_info['performance'][month_code] = metrics

                # 3. Build Final Payload
                response_payload = {
                    'success': True, 
                    'user': user_info
                }

                # Attach global data strictly for Ops/Admins
                if user_info.get('is_ops'):
                    sorted_staff = sorted(staff_data.values(), key=lambda x: x.get('name', ''))
                    response_payload['all_staff'] = sorted_staff
                    response_payload['raw_performance'] = performance_data 

                return jsonify(response_payload)
                
        return jsonify({'success': False, 'error': 'Email not authorized for UPIA Bonus.'}), 401

    except ValueError:
        return jsonify({'success': False, 'error': 'Invalid Google session.'}), 401
    
def sanitize_floats(obj):
    """Recursively converts Python Infinity and NaN into JSON-safe None (null)."""
    if isinstance(obj, dict):
        return {k: sanitize_floats(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [sanitize_floats(v) for v in obj]
    elif isinstance(obj, float):
        if math.isinf(obj) or math.isnan(obj):
            return None  
    return obj


@app.route('/api/calculate', methods=['POST'])
def calculate():
    if not app.config.get('BONUS_CONFIG'):
        # Fallback fetch if the global cache failed on boot
        app.config['BONUS_CONFIG'] = get_cached_config(app.config.get('SHEET_ID'))
        if not app.config.get('BONUS_CONFIG'):
            return jsonify({"success": False, "error": "Configuration not loaded. Check Google Sheet ID/Permissions."}), 500
        
    data = request.json
    try:
        salary = float(data.get('salary', 0))
        customers = int(data.get('customers', 0))
        if salary < 0 or customers < 0:
            raise ValueError("Salary and Customers must be non-negative.")
            
        raw_result = calculate_bonus(data, app.config['BONUS_CONFIG'])
        safe_result = sanitize_floats(raw_result)
        
        return jsonify({"success": True, **safe_result})
        
    except ValueError as ve:
        return jsonify({"success": False, "error": str(ve)}), 400
    except Exception as e:
        return jsonify({"success": False, "error": f"Calculation error: {str(e)}"}), 500


@app.route('/api/config/reload', methods=['POST'])
def reload_config():
    try:
        # Force a bypass of the Redis Cache and fetch directly from Google Sheets
        sheet_id = app.config['SHEET_ID']
        fresh_config = load_configuration(sheet_id)
        
        # Update the local app state
        app.config['BONUS_CONFIG'] = fresh_config
        app.config['CONFIG_STATUS'] = "Google Sheet Synced ✓"
        
        # Manually overwrite the Redis Cache
        cache_key = f"upia_bonus_config_{sheet_id}"
        try:
            redis_client.setex(cache_key, 300, json.dumps(fresh_config))
        except Exception as e:
            print(f"DEBUG: Redis Overwrite Error: {e}")

        return jsonify({"success": True, "message": "Configuration reloaded and Redis Cache updated successfully."})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500
@app.route('/admin')
def admin_dashboard():
    # In a fully session-backed app, you would verify an admin token here.
    # Since we are using client-side sessionStorage, the page will verify on load.
    return render_template('admin.html')

if __name__ == '__main__':
    app.run(debug=True)
    