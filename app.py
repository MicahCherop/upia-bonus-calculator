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

app = Flask(__name__)
Compress(app)

app.config['CACHE_TYPE'] = 'SimpleCache'  
app.config['CACHE_DEFAULT_TIMEOUT'] = 600  

cache = Cache(app)

redis_url = os.environ.get('REDIS_URL', 'redis://localhost:6379')
redis_client = redis.from_url(redis_url, decode_responses=True)

@cache.memoize(timeout=600)
def get_cached_config(sheet_id):
    cache_key = f"upia_bonus_config_{sheet_id}"
    
    try:
        cached_data = redis_client.get(cache_key)
        if cached_data:
            return json.loads(cached_data)
    except Exception as e:
        print(f"DEBUG: Redis Read Error: {e}")

    fresh_config = load_configuration(sheet_id)
    
    try:
        redis_client.setex(cache_key, 14400, json.dumps(fresh_config))
    except Exception as e:
        pass
        
    return fresh_config

app.config['SHEET_ID'] = os.environ.get('SHEET_ID', '1NXN8rBdusXSNQg3zbSNbxmPvb7vIiQ3vtq79lFcNi1o')
GOOGLE_CLIENT_ID = "85732911341-tfjnf14n13laa692di7ntici1d17b3pe.apps.googleusercontent.com"

try:
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
            
            is_staff = email in staff_data
            is_mgmt = email in management_data
            
            if is_staff or is_mgmt:
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
                
                if is_mgmt and "ADMIN" in str(management_data[email].get('role', emp_type)).strip().upper():
                    user_info['type'] = "System Admin"
                    emp_type = "ADMIN"

                if not user_info.get('is_ops'):
                    prev_branch = str(user_info.get('previous_branch', '')).strip().lower()
                    prev_role = str(user_info.get('previous_role', '')).strip().upper()
                    
                    # STRICT DD-MM-YYYY PARSER FOR PYTHON
                    transfer_month_code = "100000"
                    transfer_date = str(user_info.get('date_exited') or user_info.get('date_reported') or "").strip()
                    
                    if transfer_date:
                        t_str = transfer_date.replace('/', '-')
                        parts = t_str.split('-')
                        if len(parts) >= 3:
                            try:
                                day, month, year = int(parts[0]), int(parts[1]), int(parts[2])
                                if year > 2000 and 1 <= month <= 12:
                                    transfer_month_code = f"{year}{month:02d}"
                                elif day > 2000 and 1 <= month <= 12:
                                    transfer_month_code = f"{day}{month:02d}"
                            except:
                                pass

                    is_bm = "BM" in emp_type or "MANAGER" in emp_type
                    
                    # LOAD BM PERFORMANCE (CURRENT & HISTORICAL)
                    for key, metrics in bonus_config.get('bm_performance', {}).items():
                        parts = key.split('_')
                        if len(parts) == 2:
                            branch, month_code = parts[0], parts[1]
                            
                            is_hist = bool(prev_branch and month_code <= transfer_month_code)
                            active_branch = prev_branch if is_hist else user_branch
                            active_role = (prev_role if prev_role else emp_type) if is_hist else emp_type
                            
                            if ("BM" in active_role or "MANAGER" in active_role) and branch == active_branch:
                                user_info['performance'][month_code] = metrics

                    # LOAD STAFF PERFORMANCE (CURRENT & HISTORICAL)
                    for key, metrics in performance_data.items():
                        parts = key.split('_')
                        if len(parts) >= 3:
                            branch, pair_str, month_code = parts[0], parts[1], parts[-1]
                            
                            is_hist = bool(prev_branch and month_code <= transfer_month_code)
                            active_branch = prev_branch if is_hist else user_branch
                            active_role = (prev_role if prev_role else emp_type) if is_hist else emp_type
                            
                            if not ("BM" in active_role or "MANAGER" in active_role):
                                user_pair_raw = str(user_info.get('pairs', '1')).strip().lower()
                                if user_pair_raw in ['1', '']: user_pair_raw = 'pair 1'
                                elif user_pair_raw == '2': user_pair_raw = 'pair 2'
                                elif user_pair_raw == '3': user_pair_raw = 'pair 3'
                                
                                if branch == active_branch and pair_str == user_pair_raw:
                                    user_info['performance'][month_code] = metrics

                response_payload = {
                    'success': True, 
                    'user': user_info
                }

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
            return jsonify({"success": False, "error": "Configuration not loaded."}), 500
        
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
        cache.delete_memoized(get_cached_config, sheet_id)
        fresh_config = load_configuration(sheet_id)
        app.config['BONUS_CONFIG'] = fresh_config
        app.config['CONFIG_STATUS'] = "Google Sheet Synced ✓"
        
        cache_key = f"upia_bonus_config_{sheet_id}"
        try:
            redis_client.setex(cache_key, 14400, json.dumps(fresh_config))
        except:
            pass

        return jsonify({"success": True, "message": "Configuration reloaded."})
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
        target_email = data.get('target_email', '').lower()

        all_chats = redis_client.hgetall('upia_chats')
        
        if new_message:
            msg_obj = {
                "sender_name": data.get('name', 'Unknown'),
                "sender_role": "ops" if is_ops else "staff",
                "text": new_message,
                "timestamp": int(time.time()),
                "read": False
            }
            
            thread_key = target_email if is_ops else user_email
            existing_thread = all_chats.get(thread_key)
            thread_data = json.loads(existing_thread) if existing_thread else []
            thread_data.append(msg_obj)
            
            redis_client.hset('upia_chats', thread_key, json.dumps(thread_data))
            all_chats[thread_key] = json.dumps(thread_data)

        if is_ops:
            parsed_chats = {email: json.loads(msgs) for email, msgs in all_chats.items()}
            return jsonify({"success": True, "chats": parsed_chats})
        else:
            my_thread = all_chats.get(user_email)
            parsed_my_thread = json.loads(my_thread) if my_thread else []
            return jsonify({"success": True, "chats": parsed_my_thread})
            
    except Exception as e:
        return jsonify({"success": False, "error": "Failed to sync chat."}), 500

@app.route('/api/auth/logout', methods=['POST'])
def logout():
    try:
        sheet_id = app.config.get('SHEET_ID')
        # Invalidate both Flask SimpleCache and Redis keys
        cache.delete_memoized(get_cached_config, sheet_id)
        if redis_client:
            redis_client.delete(f"upia_bonus_config_{sheet_id}")
        return jsonify({"success": True, "message": "Logged out and cache invalidated."})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/calculate/bulk', methods=['POST'])
def calculate_bulk():
    if not app.config.get('BONUS_CONFIG'):
        app.config['BONUS_CONFIG'] = get_cached_config(app.config.get('SHEET_ID'))
        if not app.config.get('BONUS_CONFIG'):
            return jsonify({"success": False, "error": "Configuration not loaded."}), 500
    
    config = app.config['BONUS_CONFIG']
    data = request.json
    payloads = data.get('payloads', [])
    
    results = {}
    for req in payloads:
        try:
            email = req.get('email')
            salary = float(req.get('salary', 0))
            
            # Run the engine for each staff member in the list
            raw_result = calculate_bonus(req, config)
            safe_result = sanitize_floats(raw_result)
            
            base_bonus = safe_result.get('current', {}).get('base_bonus', 0)
            upside = safe_result.get('collection', {}).get('upside', 0)
            
            # Combine the total payout
            results[email] = salary + base_bonus + upside
        except Exception as e:
            results[req.get('email', 'unknown')] = 0
            
    return jsonify({"success": True, "payouts": results})

if __name__ == '__main__':
    app.run(debug=True)