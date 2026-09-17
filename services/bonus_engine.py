from datetime import datetime

def calculate_bonus(data, config):
    try:
        customers = int(data.get('customers', 0))
    except (ValueError, TypeError):
        customers = 0

    emp_type = str(data.get('employee_type') or data.get('type') or '').strip().upper()
    pairs_raw = str(data.get('pairs', '')).strip()
    is_bm = "BM" in emp_type or "MANAGER" in emp_type

    # Clean pairs string ("1 Pair", "2 Pairs", "3 Pairs" -> "1", "2", "3")
    pairs_clean = "1"
    if "3" in pairs_raw:
        pairs_clean = "3"
    elif "2" in pairs_raw:
        pairs_clean = "2"
    elif "1" in pairs_raw:
        pairs_clean = "1"

    # --- HARDCODED FIXED SALARIES ---
    if is_bm:
        if pairs_clean == "3":
            salary = 77000.0
        elif pairs_clean == "2":
            salary = 67507.0
        else:
            salary = 45397.0
    else:
        salary = float(data.get('salary') or 29108.0)

    # 1. Eligibility Check
    criteria = config.get('criteria', {})
        
    disb_val = round(float(data.get('disbursement', 0)), 4)
    disb_ok = disb_val >= criteria.get('disbursement', 0.98)
    
    ac_ok = round(float(data.get('active_customers', 0)), 4) >= criteria.get('active_customers', 0.95)
    nc_ok = round(float(data.get('new_customers', 0)), 4) >= criteria.get('new_customers', 0.95)
    otc_ok = round(float(data.get('otc', 0)), 4) >= criteria.get('otc', 0.915)
    dd7_ok = round(float(data.get('dd7', 0)), 4) >= criteria.get('dd7', 0.94)
    
    new_otc_val = float(data.get('new_customer_otc', 0))
    new_otc_ok = round(new_otc_val, 4) >= criteria.get('new_customer_otc', 0.90)

    # --- ROBUST WAIVER FOR NEW CUSTOMER OTC & HISTORICAL TRANSFERS ---
    month_code = str(data.get('month', '')).strip() 
    is_historical = bool(data.get('is_previous') or data.get('is_historical'))

    if (month_code and month_code <= "202607") or new_otc_val == 0 or is_historical:
        new_otc_ok = True 
    # --------------------------------------------------------

    full_bonus = disb_ok and ac_ok and nc_ok and otc_ok and dd7_ok and new_otc_ok
    
    # --- 45% BONUS QUALIFICATION (Added 95% Disbursement Minimum) ---
    disb_45_ok = disb_val >= 0.95
    collection_bonus_45 = (not full_bonus) and (otc_ok and dd7_ok and new_otc_ok and disb_45_ok)

    # --- DATE REPORTED LOGIC ---
    date_reported_raw = str(data.get('date_reported', '')).strip().lower()
    
    # Catch any garbage strings sent by JS or Sheets
    safe_blanks = ['nan', 'null', 'n/a', 'na', 'none', 'not reported', '-', 'invalid date', 'undefined', '']
    
    # Safely strip timestamps or ISO 'T' markers to isolate the date
    date_reported_str = date_reported_raw.split(' ')[0].split('t')[0]
    
    if date_reported_raw in safe_blanks or date_reported_str in safe_blanks:
        date_reported_str = ''
        
    date_disqualified = False 
    
    # RULE: If Date Reported is empty or staff is transferred, there is NO date limit.
    if not date_reported_str or is_historical:
        date_disqualified = False
        
    elif month_code and len(month_code) == 6:
        from datetime import datetime, date
        
        def _parse_date(d_str):
            # Covers 2-digit years (%y), 4-digit years (%Y), and text months (%b)
            formats = [
                '%d-%m-%Y', '%d/%m/%Y', '%Y-%m-%d', '%Y/%m/%d',
                '%d-%b-%Y', '%d %b %Y', '%m-%d-%Y', '%m/%d/%Y',
                '%d-%m-%y', '%d/%m/%y', '%m-%d-%y', '%m/%d/%y'
            ]
            for fmt in formats:
                try:
                    return datetime.strptime(d_str, fmt).date()
                except ValueError:
                    continue
            return None
            
        rep_date = _parse_date(date_reported_str)
        if rep_date:
            try:
                perf_year = int(month_code[:4])
                perf_month = int(month_code[4:6])
                
                # Check 5th of the month cutoff ONLY for staff with an actual reporting date
                cutoff_date = date(perf_year, perf_month, 5)
                
                if rep_date > cutoff_date:
                    full_bonus = False
                    collection_bonus_45 = False
                    date_disqualified = True
                    
            except Exception:
                pass
    # --------------------------------

    eligibility = {
        "full_bonus": full_bonus,
        "collection_bonus_45": collection_bonus_45,
        "date_disqualified": date_disqualified 
    }

    # 2. Select Band Table based on Role & Pairs
    if is_bm:
        bm_bands = config.get('bm_bands', {})
        bands = bm_bands.get(pairs_clean, bm_bands.get("1", []))
    else:
        bands = config.get('loco_bands', [])

    current_band = "Floor"
    display_multiplier = 0.0
    active_multiplier = 0.0
    next_band_info = None
    
    current_min = 0
    current_max = 0

    if bands:
        for idx, band in enumerate(bands):
            if customers <= band.get('max', float('inf')):
                current_band = band['name']
                
                current_max = band.get('max', float('inf'))
                current_min = 0 if idx == 0 else bands[idx - 1].get('max', 0) + 1

                full_mult = band.get('full_mult', band.get('multiplier', 0.0))
                
                if is_bm:
                    partial_mult = band.get('partial_mult', full_mult * 0.45)
                else:
                    if current_max <= 200: partial_mult = 0.25
                    elif current_max <= 350: partial_mult = 0.30
                    elif current_max <= 500: partial_mult = 0.45
                    else: partial_mult = 0.50

                display_multiplier = full_mult

                if full_bonus:
                    active_multiplier = full_mult
                elif collection_bonus_45:
                    active_multiplier = partial_mult
                else:
                    active_multiplier = 0.0

                if idx + 1 < len(bands):
                    next_b = bands[idx + 1]
                    next_min = current_max + 1
                    next_max = next_b.get('max', float('inf'))
                    thresh = next_max if next_max != float('inf') else next_min
                    cust_needed = next_min - customers if next_min > customers else 0

                    next_full_mult = next_b.get('full_mult', next_b.get('multiplier', 0.0))
                    pot_bonus = salary * next_full_mult
                    curr_bonus = salary * active_multiplier
                    opp = pot_bonus - curr_bonus

                    min_thresh_math = 0 if idx == 0 else bands[idx - 1].get('max', 0)
                    denom = current_max - min_thresh_math
                    
                    prog = 100 if (denom == float('inf') or denom <= 0) else ((customers - min_thresh_math) / denom * 100)
                    prog = min(max(prog, 0), 100)

                    next_band_info = {
                        "band": next_b['name'],
                        "min": next_min,
                        "max": next_max,
                        "threshold": thresh,
                        "customers_needed": cust_needed,
                        "potential_bonus": pot_bonus,
                        "bonus_opportunity": opp,
                        "progress_percent": round(prog, 1)
                    }
                break

    # 3. Compute Base Bonus Payout
    base_bonus = salary * active_multiplier

    # 4. Compute Founder's Collection Upside Bonus (Using DD+7)
    collection_upside = 0.0
    
    if not date_disqualified:
        dd7_val = float(data.get('dd7', 0))
        disb_actual = float(data.get('disb_actual', 0))

        upside_config = config.get('collection_upside', {})
        if is_bm and pairs_clean in ["2", "3"]:
            upside_table = upside_config.get('bm_2_3pair', [])
        else:
            upside_table = upside_config.get('loco_1pair', [])

        target_row = None
        for row in upside_table:
            if row.get('min', 0) <= disb_actual <= row.get('max', float('inf')):
                target_row = row
                break

        if not target_row and len(upside_table) > 0:
            target_row = upside_table[0]

        if target_row:
            best_payout = 0.0
            for thresh_str, amt in target_row.get('payouts', {}).items():
                thresh = float(thresh_str)
                if dd7_val >= (thresh - 0.0001):
                    if amt > best_payout:
                        best_payout = amt
            
            if full_bonus:
                collection_upside = best_payout * 1.0
            elif collection_bonus_45:
                collection_upside = best_payout * 0.50
            else:
                collection_upside = best_payout * 0.40

    return {
        "eligibility": eligibility,
        "current": {
            "band": current_band,
            "min": current_min,
            "max": current_max,
            "multiplier": active_multiplier,
            "customers": customers,
            "base_bonus": base_bonus
        },
        "next_band": next_band_info,
        "collection": {
            "upside": collection_upside
        }
    }

def evaluate_criteria(data, criteria_targets, emp_type=""):
    results = []
    
    for key, target in criteria_targets.items():
        # New Customer OTC is now visible and evaluated for everyone
        actual = float(data.get(key, 0))
        passed = actual >= target
        results.append({
            "key": key,
            "name": key.replace('_', ' ').title(),
            "actual": actual,
            "target": target,
            "passed": passed,
            "gap": round((target - actual) * 100, 2) if not passed else 0
        })
    return results

def get_band(customers, bands):
    for b in bands:
        if customers <= b['max']:
            return b
    return bands[-1] 

def get_next_band(customers, bands):
    for i, b in enumerate(bands):
        if customers <= b['max']:
            if i + 1 < len(bands) and bands[i+1]['max'] != float('inf'):
                return {"name": bands[i+1]['name'], "threshold": b['max'] + 1}
            elif i + 1 < len(bands) and bands[i+1]['max'] == float('inf'):
                return {"name": bands[i+1]['name'], "threshold": b['max'] + 1}
            return None
    return None

def calculate_base(salary, multiplier, full_bonus, col_bonus_passed):
    if full_bonus:
        return salary * multiplier
    elif col_bonus_passed:
        return (salary * multiplier) * 0.45
    return 0