import os
import json
import math
import redis
import time
import psutil
import csv
from flask_cors import CORS
from io import StringIO
from flask import Response
from flask import request
from flask import Flask, request, jsonify, render_template, send_from_directory
from google.oauth2 import id_token
from google.auth.transport import requests
from services.config_loader import load_configuration
from services.bonus_engine import calculate_bonus
from dotenv import load_dotenv
from flask_compress import Compress
from flask_caching import Cache
from flask import Flask, session, jsonify, request

load_dotenv()

app = Flask(__name__)
Compress(app)

app = Flask(__name__)
Compress(app)

# Required for session cookies to function securely
app.secret_key = os.environ.get('SECRET_KEY', 'upia-secure-secret-key-change-in-prod')

app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SECURE=True,
    SESSION_COOKIE_SAMESITE='Lax'
)
# --- ADD THIS CORS SECURITY BLOCK ---
cors_origins = os.environ.get('CORS_ORIGINS', '*')
if cors_origins == '*':
    # If not defined, allow all (will trigger the Warning badge)
    CORS(app)
else:
    # Lock down /api/ routes to specific domains (Secured)
    allowed_domains = [domain.strip() for domain in cors_origins.split(',')]
    CORS(app, resources={r"/api/*": {"origins": allowed_domains}})
# ------------------------------------

app.config['CACHE_TYPE'] = 'SimpleCache'  
app.config['CACHE_DEFAULT_TIMEOUT'] = 600  

cache = Cache(app)

redis_url = os.environ.get('REDIS_URL', 'redis://localhost:6379')
redis_client = redis.from_url(redis_url, decode_responses=True)

@app.route('/api/performance/<target_staff_id>', methods=['GET'])
def get_staff_performance(target_staff_id):
    # 1. Authentication Check
    user = session.get('user')
    if not user:
        return jsonify({"error": "Unauthenticated"}), 401

    # 2. Extract normalized role and staff ID from session
    user_role = str(user.get('type', '')).strip().upper()
    user_staff_id = str(user.get('id', '')).strip()

    # 3. IDOR Protection: Block LOCO staff from accessing records other than their own
    if "LOCO" in user_role and user_staff_id != str(target_staff_id).strip():
        return jsonify({"error": "Unauthorized access to staff record"}), 403

    # 4. Fetch configurations from Cache/Redis
    config = app.config.get('BONUS_CONFIG') or get_cached_config(app.config.get('SHEET_ID'))
    if not config:
        return jsonify({"error": "Configuration unavailable"}), 500

    # 5. Locate requested staff record by ID across staff and management pools
    staff_pool = list(config.get('staff', {}).values()) + list(config.get('management', {}).values())
    target_record = next(
        (member for member in staff_pool if str(member.get('id', '')).strip() == str(target_staff_id).strip()),
        None
    )

    if not target_record:
        return jsonify({"error": "Staff record not found"}), 404

    return jsonify({"success": True, "data": target_record}), 200


# ==========================================
# 1. LIVE USER HEARTBEAT & ACTIVITY LOGGER
# ==========================================
@app.route('/api/system/ping', methods=['POST'])
def system_ping():
    data = request.get_json() or {}
    email = data.get('email', 'Anonymous')
    name = data.get('name', 'Unknown User')
    action = data.get('action', 'Active on Dashboard')

    try:
        current_time = int(time.time())
        
        # 1. Track Live Active Users (Expires after 120 seconds of inactivity)
        redis_client.zadd("live_users_timestamps", mapping={email: current_time})
        
        # 2. Store the user's name for UI display
        redis_client.hset("live_users_names", email, name)

        # 3. Append to Permanent Historical Activity Log (Skip background pings)
        if action != 'Active on Dashboard':
            log_entry = {
                "time": time.strftime("%I:%M %p"),
                "date": time.strftime("%Y-%m-%d"),
                "user": name,
                "email": email,
                "action": action
            }
            # Push to a persistent Redis list and keep the last 1000 logs
            redis_client.lpush("historical_activity_log", json.dumps(log_entry))
            redis_client.ltrim("historical_activity_log", 0, 999) 

        return jsonify({"success": True})
    except Exception as e:
        print(f"Ping Error: {e}")
        return jsonify({"success": False, "error": str(e)}), 500
    
# ==========================================
# 1. THE GLOBAL IP BOUNCER (BULLETPROOFED)
# ==========================================
@app.before_request
def enforce_ip_ban():
    # Safely get the user's IP
    client_ip = request.headers.get('X-Forwarded-For', request.remote_addr)
    
    # Ensure client_ip exists before checking Redis to prevent NoneType crashes
    if client_ip:
        try:
            if redis_client.sismember("banned_ips", client_ip):
                return jsonify({"error": "Access Denied: Malicious activity detected."}), 403
        except Exception as e:
            print(f"Redis IP Check Error: {e}")

# ==========================================
# 2. THE ADMIN ENDPOINT TO BLOCK AN IP
# ==========================================
@app.route('/api/admin/security/block', methods=['POST'])
def block_suspicious_ip():
    # Safely handle missing JSON data
    data = request.json or {}
    ip_to_block = data.get('ip')
    
    if not ip_to_block:
        return jsonify({"error": "IP address required"}), 400
        
    try:
        redis_client.sadd("banned_ips", ip_to_block)
        
        # Safely dump JSON to prevent decode errors later
        action_log = {
            "time": "Just now", 
            "user": "System Admin", 
            "action": f"Banned IP: {ip_to_block}"
        }
        redis_client.lpush("live_activities", json.dumps(action_log))
        
        return jsonify({"status": "success", "message": f"IP {ip_to_block} blocked permanently."})
    except Exception as e:
        return jsonify({"error": f"Failed to block IP: {str(e)}"}), 500

# ==========================================
# 3. METRICS ENDPOINT (BULLETPROOFED)
# ==========================================
@app.route('/api/admin/metrics', methods=['GET'])
def get_admin_metrics():
    try:
        current_time = int(time.time())
        
        # 1. Active Users Tracker (Resilient to Redis connection pool limits)
        try:
            redis_client.zremrangebyscore("live_users_timestamps", 0, current_time - 120)
            active_count = redis_client.zcard("live_users_timestamps") or 0
        except Exception as r_err:
            print(f"Metrics Redis Active User Error: {r_err}")
            active_count = 0

        # 2. Server Load (Non-blocking hardware check)
        try:
            cpu_load = psutil.cpu_percent(interval=None)
        except Exception:
            cpu_load = 0.0

        # 3. Pull Recent Historical Activities
        recent_activities = []
        try:
            raw_activities = redis_client.lrange("historical_activity_log", 0, 9) or []
            for act in raw_activities:
                try:
                    recent_activities.append(json.loads(act))
                except (json.JSONDecodeError, TypeError):
                    continue
        except Exception as r_err:
            print(f"Metrics Redis Activity Log Error: {r_err}")

        # 4. Pull Recent Threats
        recent_threats = []
        try:
            raw_threats = redis_client.lrange("live_threats", 0, 4) or []
            for t in raw_threats:
                try:
                    recent_threats.append(json.loads(t))
                except (json.JSONDecodeError, TypeError):
                    continue
        except Exception as r_err:
            print(f"Metrics Redis Threat Log Error: {r_err}")

        # 5. API Latency Calculation
        try:
            latency_val = redis_client.get("avg_api_latency")
            latency = int(float(latency_val)) if latency_val else 45
        except (ValueError, TypeError, Exception):
            latency = 45

        metrics_payload = {
            "active_sessions": active_count,
            "cpu_load": cpu_load,
            "api_latency": latency,
            "is_crashing": cpu_load > 90, 
            "recent_activities": recent_activities,
            "recent_threats": recent_threats
        }
        
        return jsonify(metrics_payload), 200

    except Exception as e:
        print(f"Metrics Route Fallback Triggered: {e}")
        # Return fallback JSON payload so dashboard polling components never crash with HTTP 500s
        return jsonify({
            "active_sessions": 0,
            "cpu_load": 0.0,
            "api_latency": 45,
            "is_crashing": False,
            "recent_activities": [],
            "recent_threats": [],
            "warning": "Metrics temporarily degraded under heavy load"
        }), 200
# ==========================================
# 1. API LATENCY TRACKER (The Speedometer)
# ==========================================
@app.after_request
def log_api_latency(response):
    # Only track if start_time exists (set in before_request) and it's an API route
    if hasattr(request, 'start_time') and request.path.startswith('/api/'):
        try:
            # Calculate total time in milliseconds
            latency_ms = int((time.time() - request.start_time) * 1000)
            
            # Push to Redis and keep only the last 100 requests
            redis_client.lpush("api_latency_history", latency_ms)
            redis_client.ltrim("api_latency_history", 0, 99)
            
            # Calculate the moving average
            latencies = [int(x) for x in redis_client.lrange("api_latency_history", 0, 99)]
            if latencies:
                avg = sum(latencies) / len(latencies)
                redis_client.set("avg_api_latency", avg)
        except Exception as e:
            print(f"DEBUG: Latency tracking error: {e}")
            
    return response

# ==========================================
# 2. CACHE HIT TRACKER (The Cost Saver)
# ==========================================
@cache.memoize(timeout=600)
def get_cached_config(sheet_id):
    cache_key = f"upia_bonus_config_{sheet_id}"
    
    try:
        cached_data = redis_client.get(cache_key)
        if cached_data:
            # IT'S A HIT! We saved a Google API call.
            redis_client.incr("cache_hits")
            return json.loads(cached_data)
    except Exception as e:
        print(f"DEBUG: Redis Read Error: {e}")

    # IT'S A MISS. We have to hit Google Sheets.
    redis_client.incr("cache_misses")
    fresh_config = load_configuration(sheet_id)
    
    try:
        redis_client.setex(cache_key, 14400, json.dumps(fresh_config))
    except Exception as e:
        pass
        
    return fresh_config

# ==========================================
# 3. PERFORMANCE METRICS ENDPOINT
# ==========================================
@app.route('/api/admin/performance', methods=['GET'])
def get_system_performance():
    try:
        # Get Average Latency
        latency = float(redis_client.get("avg_api_latency") or 0)
        
        # Calculate Cache Hit Rate
        hits = int(redis_client.get("cache_hits") or 0)
        misses = int(redis_client.get("cache_misses") or 0)
        total_requests = hits + misses
        
        if total_requests > 0:
            cache_hit_rate = (hits / total_requests) * 100
        else:
            cache_hit_rate = 100.0 # Default to perfect if no traffic yet
            
        # Get Server Hardware Load
        cpu_load = psutil.cpu_percent(interval=None)
        memory_usage = psutil.virtual_memory().percent

        # Calculate Google Sheets Sync Success Rate
        sync_history = redis_client.lrange("sheet_sync_history", 0, 49)
        if sync_history:
            successes = sum(1 for x in sync_history if x == "1")
            sync_rate = (successes / len(sync_history)) * 100
        else:
            sync_rate = 100.0

        return jsonify({
            "success": True,
            "api_latency_ms": int(latency),
            "cache_hit_rate": round(cache_hit_rate, 1),
            "cpu_load": cpu_load,
            "memory_usage": memory_usage,
            "db_latency": 15 # Placeholder until we wire up the DB tracker
        })
    except Exception as e:
        return jsonify({"error": f"Failed to fetch performance data: {str(e)}"}), 500

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


# 1. Create a global memory cache
GLOBAL_OPS_CACHE = {
    "all_staff": None,
    "raw_performance": None,
    "last_updated": 0
}

@app.route('/api/auth/google', methods=['POST'])
def auth_google():
    # Safely handle empty requests
    data = request.get_json() or {}
    token = data.get('credential')

    if not token:
        return jsonify({'success': False, 'error': 'Missing Google token from frontend.'}), 400

    try:
        # Add a 60-second grace period for server clock drift
        idinfo = id_token.verify_oauth2_token(
            token, 
            requests.Request(), 
            GOOGLE_CLIENT_ID, 
            clock_skew_in_seconds=60
        )
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

                # Save user to Flask session so subsequent API calls can verify identity
                session['user'] = user_info
                session.permanent = True

                # CACHING FOR OPS MANAGERS
                if user_info.get('is_ops'):
                    current_time = time.time()
                    if not GLOBAL_OPS_CACHE["all_staff"] or (current_time - GLOBAL_OPS_CACHE["last_updated"] > 3600):
                        
                        # FIX: Combine both Staff and Management into one master list
                        combined_users = list(staff_data.values()) + list(management_data.values())
                        sorted_staff = sorted(combined_users, key=lambda x: str(x.get('name', '')))
                        
                        merged_perf = {**bonus_config.get("performance", {}), **bonus_config.get("bm_performance", {})}
                        
                        GLOBAL_OPS_CACHE["all_staff"] = sorted_staff
                        GLOBAL_OPS_CACHE["raw_performance"] = merged_perf
                        GLOBAL_OPS_CACHE["last_updated"] = current_time

                    response_payload['all_staff'] = GLOBAL_OPS_CACHE["all_staff"]
                    response_payload['raw_performance'] = GLOBAL_OPS_CACHE["raw_performance"]

                return jsonify(response_payload)
                
        return jsonify({'success': False, 'error': 'Email not authorized for UPIA Bonus.'}), 401

    except Exception as e:
        # Catch ALL unexpected errors so Flask never returns HTML 500s
        print(f"DEBUG: Auth Crash - {e}")
        return jsonify({'success': False, 'error': f'Authentication failed: {str(e)}'}), 401
    
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

    data = dict(request.json or {})
    try:
        salary = float(data.get('salary', 0))
        customers = int(data.get('customers', 0))
        if salary < 0 or customers < 0:
            raise ValueError("Salary and Customers must be non-negative.")

        # Strip "(Previous)" string added by UI for transferred staff
        if 'branch' in data:
            data['branch'] = str(data['branch']).replace('(Previous)', '').replace('(previous)', '').strip().lower()

        raw_result = calculate_bonus(data, app.config['BONUS_CONFIG'])
        safe_result = sanitize_floats(raw_result)

        # Audit Trail Logging (Safely guarded against NoneType sessions)
        user_info = session.get('user') or {}
        audit_entry = {
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
            "epoch": int(time.time()),
            "executed_by": user_info.get('email', 'Anonymous'),
            "user_role": user_info.get('type', 'Unknown'),
            "input_payload": data,
            "calculated_payout": safe_result,
            "sheet_version": app.config.get('BONUS_CONFIG', {}).get('version', 'v1.0')
        }

        try:
            redis_client.lpush("audit_trail:calculations", json.dumps(audit_entry))
            redis_client.ltrim("audit_trail:calculations", 0, 9999)  # Retain last 10,000 runs
        except Exception as log_err:
            print(f"Audit Log Error: {log_err}")

        return jsonify({"success": True, **safe_result})

    except ValueError as ve:
        return jsonify({"success": False, "error": str(ve)}), 400
    except Exception as e:
        return jsonify({"success": False, "error": f"Calculation error: {str(e)}"}), 500

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
            
            # Apply the same fix for the bulk calculator
            branch_str = str(req.get('branch', '')).lower()
            if "(previous)" in branch_str:
                req['branch'] = branch_str.replace("(previous)", "").strip()
            elif req.get('previous_branch') and req.get('is_historical'):
                req['branch'] = str(req.get('previous_branch')).strip().lower()
            
            raw_result = calculate_bonus(req, config)
            safe_result = sanitize_floats(raw_result)
            
            base_bonus = safe_result.get('current', {}).get('base_bonus', 0)
            upside = safe_result.get('collection', {}).get('upside', 0)
            
            results[email] = salary + base_bonus + upside
        except Exception as e:
            results[req.get('email', 'unknown')] = 0
            
    return jsonify({"success": True, "payouts": results})

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


# ==========================================
# LIVE SYSTEM SECURITY AUDIT
# ==========================================
@app.route('/api/admin/security-audit', methods=['GET'])
def security_audit():
    # 1. Check Google OAuth Integrity
    # Verifies that the Client ID is loaded and not empty
    oauth_status = "Secure" if getattr(app, 'GOOGLE_CLIENT_ID', GOOGLE_CLIENT_ID) else "Warning"
    
    # 2. Check Redis Cache Protection
    # Pings the memory database to ensure it's responsive
    try:
        if redis_client.ping():
            redis_status = "Secure"
        else:
            redis_status = "Warning"
    except Exception as e:
        print(f"Redis Audit Failed: {e}")
        redis_status = "Warning"
        
    # 3. Check CORS Policies
    # If CORS_ORIGINS isn't explicitly set in your .env, it often defaults to "*" (Open to everyone)
    cors_config = os.environ.get('CORS_ORIGINS', '*')
    cors_status = "Warning" if cors_config == '*' else "Secure"

    return jsonify({
        "success": True,
        "oauth": oauth_status,
        "redis": redis_status,
        "cors": cors_status
    })

# ==========================================
# THREAT WATCHLIST (Rate Limiting Visuals)
# ==========================================
@app.route('/api/admin/security/watchlist', methods=['GET'])
def get_security_watchlist():
    # In a real login route, you would do: redis_client.incr("failed_auth:192.168.1.50")
    # Here, we scan Redis for anyone with active strikes (1 to 4 fails)
    watchlist = []
    
    try:
        # Find all keys matching our failed auth pattern
        keys = redis_client.keys("failed_auth:*")
        for key in keys:
            ip = key.split(":")[1]
            attempts = int(redis_client.get(key) or 0)
            if 0 < attempts < 5:  # 5 is the ban threshold
                watchlist.append({"ip": ip, "attempts": attempts})
    except Exception as e:
        print(f"Watchlist Error: {e}")
        
    return jsonify({"success": True, "watchlist": watchlist})

# ==========================================
# EXPORT SECURITY LOG (CSV Paper Trail)
# ==========================================
@app.route('/api/admin/security/export', methods=['GET'])
def export_security_log():
    try:
        # 1. Pull recent activities and threats from Redis safely
        raw_threats = redis_client.lrange("live_threats", 0, -1) or []
        banned_ips = redis_client.smembers("banned_ips") or set()
        
        # 2. Create an in-memory CSV file
        si = StringIO()
        cw = csv.writer(si)
        
        # 3. Write Headers
        cw.writerow(['Type', 'Timestamp', 'IP Address / User', 'Details'])
        
        # 4. Write Banned IPs
        for ip in banned_ips:
            cw.writerow(['BANNED IP', 'Permanent', ip, 'Blocked by Admin or System'])
        # 4.5 Write Historical Activity
        raw_activities = redis_client.lrange("historical_activity_log", 0, -1) or []
        for act in raw_activities:
            try:
                act_data = json.loads(act)
                cw.writerow(['ACTIVITY', f"{act_data.get('date', '')} {act_data.get('time', '')}", act_data.get('user', ''), act_data.get('action', '')])
            except:
                pass

        # 5. Write Threat Logs
        for t in raw_threats:
            try:
                # Use json to parse the stored Redis strings
                import json
                t_data = json.loads(t)
                cw.writerow(['THREAT', t_data.get('time', ''), t_data.get('ip', ''), t_data.get('threat', '')])
            except Exception as parse_err:
                # If a log is corrupted, just write the raw string instead of crashing
                cw.writerow(['THREAT', 'Unknown', 'Unknown', str(t)])
                
        output = si.getvalue()
        
        # 6. Return as a downloadable CSV file
        return Response(
            output,
            mimetype="text/csv",
            headers={"Content-Disposition": "attachment;filename=upia_security_audit.csv"}
        )
    except Exception as e:
        print(f"DEBUG: CSV Export Error - {str(e)}")
        return jsonify({"error": f"Failed to export logs: {str(e)}"}), 500

# ==========================================
# GOOGLE SHEETS SYNC TRACKER
# ==========================================
def log_sheet_sync(success=True):
    """Logs a 1 (success) or 0 (failure) to Redis for the last 50 attempts."""
    try:
        val = "1" if success else "0"
        redis_client.lpush("sheet_sync_history", val)
        redis_client.ltrim("sheet_sync_history", 0, 49)
    except:
        pass

# ==========================================
# FORCE HARD SYNC ENDPOINT (The Nuclear Option)
# ==========================================
@app.route('/api/admin/system/flush', methods=['POST'])
def flush_and_sync():
    try:
        # 1. Wipe all Redis data (clears cache, sessions, etc.)
        redis_client.flushdb()
        
        # 2. Force a fresh download from Google Sheets
        sheet_id = app.config.get('SHEET_ID')
        fresh_config = load_configuration(sheet_id)
        log_sheet_sync(success=True)
        
        # 3. Rebuild the cache immediately
        cache_key = f"upia_bonus_config_{sheet_id}"
        redis_client.setex(cache_key, 14400, json.dumps(fresh_config))
        app.config['BONUS_CONFIG'] = fresh_config
        
        # 4. Clear the global Python memory cache
        GLOBAL_OPS_CACHE["all_staff"] = None
        GLOBAL_OPS_CACHE["raw_performance"] = None
        
        return jsonify({"success": True, "message": "System fully flushed and re-synced with Google Sheets!"})
    except Exception as e:
        log_sheet_sync(success=False)
        return jsonify({"error": f"Hard sync failed: {str(e)}"}), 500



if __name__ == '__main__':
    app.run(debug=True)