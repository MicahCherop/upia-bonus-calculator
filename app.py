import os
import json
import math
import redis
import time
from flask import Flask, request, jsonify, render_template, send_from_directory
from google.oauth2 import id_token
from google.auth.transport import requests
from services.config_loader import load_configuration
from services.bonus_engine import calculate_bonus
from dotenv import load_dotenv
from flask_compress import Compress
from flask_caching import Cache

load_dotenv()

# 1. Initialize Flask & Extensions Once
app = Flask(__name__)
Compress(app)

app.config['CACHE_TYPE'] = 'SimpleCache'  
app.config['CACHE_DEFAULT_TIMEOUT'] = 600  # Hold data in memory for 10 minutes

cache = Cache(app)

# Initialize Redis connection
redis_url = os.environ.get('REDIS_URL', 'redis://localhost:6379')
redis_client = redis.from_url(redis_url, decode_responses=True)

# 2. Apply In-Memory Caching directly to the Config Loader
@cache.memoize(timeout=600)
def get_cached_config(sheet_id):
    cache_key = f"upia_bonus_config_{sheet_id}"
    
    try:
        # Layer 2: Try to fetch from Redis
        cached_data = redis_client.get(cache_key)
        if cached_data:
            print("DEBUG: Serving config from Redis Cache!")
            return json.loads(cached_data)
    except Exception as e:
        print(f"DEBUG: Redis Read Error (falling back to Google): {e}")

    # Layer 3: Cache Miss - Fetch fresh data from Google Sheets
    print("DEBUG: Cache miss. Fetching fresh data from Google Sheets...")
    fresh_config = load_configuration(sheet_id)
    
    try:
        # Save to Redis with a 4-hour (14400 seconds) expiration
        redis_client.setex(cache_key, 14400, json.dumps(fresh_config))
        print("DEBUG: Successfully saved fresh config to Redis.")
    except Exception as e:
        print(f"DEBUG: Redis Write Error: {e}")
        
    return fresh_config

# Set the exact Sheet ID as the permanent fallback
app.config['SHEET_ID'] = os.environ.get('SHEET_ID', '1NXN8rBdusXSNQg3zbSNbxmPvb7vIiQ3vtq79lFcNi1o')
GOOGLE_CLIENT_ID = "85732911341-tfjnf14n13laa692di7ntici1d17b3pe.apps.googleusercontent.com"

try:
    # Pre-load configuration on boot
    app.config['BONUS_CONFIG'] = get_cached_config(app.config['SHEET_ID'])
    app.config['CONFIG_STATUS'] = "Google Sheet Synced ✓"
except Exception as e:
    app.config['BONUS_CONFIG'] = None
    app.config['CONFIG_STATUS'] = f"Failed: {str(e)}"


@app.route('/sw.js')
def serve_sw():
    return send_from_directory('static', 'sw.js', mimetype='application/javascript')

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/overview')
def overview():
    return render_template('overview.html')

@app.route('/band-guide')
def band_guide():
    return render_template('band-guide.html')

@app.route('/help')
def help_page():
    return render_template('help.html')

@app.route('/api/auth/google', methods=['POST'])
def auth_google():
    data = request.get_json()
    token = data.get('credential')

    try:
        idinfo = id_token.verify_oauth2_token(token, requests.Request(), GOOGLE_CLIENT_ID)
        email = idinfo['email'].lower()
        
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

                # 2. Fetch User Performance Data
                if not user_info.get('is_ops'):
                    is_bm = "BM" in emp_type or "MANAGER" in emp_type
                    
                    if is_bm:
                        bm_performance_data = bonus_config.get('bm_performance', {})
                        for key, metrics in bm_performance_data.items():
                            parts = key.split('_')
                            if len(parts) == 2 and parts[0] == user_branch:
                                month_code = parts[1]
                                user_info['performance'][month_code] = metrics
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
                    
                    merged_perf = {**bonus_config.get("performance", {}), **bonus_config.get("bm_performance", {})}
                    response_payload['raw_performance'] = merged_perf 

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
        sheet_id = app.config['SHEET_ID']
        
        # 1. Clear the In-Memory RAM Cache
        cache.delete_memoized(get_cached_config, sheet_id)
        
        # 2. Fetch fresh from Google Sheets
        fresh_config = load_configuration(sheet_id)
        app.config['BONUS_CONFIG'] = fresh_config
        app.config['CONFIG_STATUS'] = "Google Sheet Synced ✓"
        
        # 3. Manually overwrite the Redis Cache
        cache_key = f"upia_bonus_config_{sheet_id}"
        try:
            redis_client.setex(cache_key, 14400, json.dumps(fresh_config))
        except Exception as e:
            print(f"DEBUG: Redis Overwrite Error: {e}")

        return jsonify({"success": True, "message": "Configuration reloaded and all caches updated successfully."})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/admin')
def admin_dashboard():
    return render_template('admin.html')

@app.route('/api/chat/sync', methods=['POST'])
def sync_chat():
    try:
        data = request.json
        user_email = data.get('email', '').lower()
        is_ops = data.get('is_ops', False)
        new_message = data.get('message', '').strip()
        target_email = data.get('target_email', '').lower() # Used when Ops replies to a specific staff member

        # We will store all chats in a single Redis Hash named 'upia_chats'
        # Key: Staff Email -> Value: JSON list of message objects
        all_chats = redis_client.hgetall('upia_chats')
        
        # 1. Handle Sending a New Message
        if new_message:
            msg_obj = {
                "sender": "ops" if is_ops else "staff",
                "text": new_message,
                "timestamp": int(time.time()),
                "read": False
            }
            
            # Determine which chat thread to update
            thread_key = target_email if is_ops else user_email
            
            # Load existing thread or create new
            existing_thread = all_chats.get(thread_key)
            thread_data = json.loads(existing_thread) if existing_thread else []
            thread_data.append(msg_obj)
            
            # Save back to Redis
            redis_client.hset('upia_chats', thread_key, json.dumps(thread_data))
            # Refresh our local variable so the response includes the new message
            all_chats[thread_key] = json.dumps(thread_data)

        # 2. Return Data based on Role
        if is_ops:
            # Ops Manager gets ALL chats across the whole branch
            parsed_chats = {email: json.loads(msgs) for email, msgs in all_chats.items()}
            return jsonify({"success": True, "chats": parsed_chats})
        else:
            # Staff only gets THEIR specific chat thread
            my_thread = all_chats.get(user_email)
            parsed_my_thread = json.loads(my_thread) if my_thread else []
            return jsonify({"success": True, "chats": parsed_my_thread})
            
    except Exception as e:
        print(f"Chat Sync Error: {e}")
        return jsonify({"success": False, "error": "Failed to sync chat."}), 500

if __name__ == '__main__':
    app.run(debug=True)