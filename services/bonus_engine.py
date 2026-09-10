def calculate_bonus(data, config):
    try:
        salary = float(data.get('salary', 0))
    except (ValueError, TypeError):
        salary = 0.0

    try:
        customers = int(data.get('customers', 0))
    except (ValueError, TypeError):
        customers = 0

    emp_type = str(data.get('employee_type', '')).strip().upper()
    pairs_raw = str(data.get('pairs', '')).strip()

    # Clean pairs string ("1 Pair", "2 Pairs", "3 Pairs" -> "1", "2", "3")
    pairs_clean = "1"
    if "3" in pairs_raw:
        pairs_clean = "3"
    elif "2" in pairs_raw:
        pairs_clean = "2"
    elif "1" in pairs_raw:
        pairs_clean = "1"

    # 1. Eligibility Check
    criteria = config.get('criteria', {})
    disb_ok = float(data.get('disbursement', 0)) >= criteria.get('disbursement', 0.98)
    ac_ok = float(data.get('active_customers', 0)) >= criteria.get('active_customers', 0.95)
    nc_ok = float(data.get('new_customers', 0)) >= criteria.get('new_customers', 0.95)
    otc_ok = float(data.get('otc', 0)) >= criteria.get('otc', 0.915)
    dd7_ok = float(data.get('dd7', 0)) >= criteria.get('dd7', 0.94)
    new_otc_ok = float(data.get('new_customer_otc', 0)) >= criteria.get('new_customer_otc', 0.90)

    full_bonus = disb_ok and ac_ok and nc_ok and otc_ok and dd7_ok and new_otc_ok
    collection_bonus_45 = (not full_bonus) and (otc_ok and dd7_ok)

    eligibility = {
        "full_bonus": full_bonus,
        "collection_bonus_45": collection_bonus_45
    }

    is_bm = "BM" in emp_type or "BRANCH MANAGER" in emp_type

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
    
    # Initialize bounds for the UI
    current_min = 0
    current_max = 0

    if bands:
        for idx, band in enumerate(bands):
            if customers <= band['max']:
                current_band = band['name']
                
                # Dynamically set display boundaries for UI
                current_max = band['max']
                current_min = 0 if idx == 0 else bands[idx - 1]['max'] + 1

                # Fetch Multipliers (handling BM distinct values vs LOCO single values)
                full_mult = band.get('full_mult', band.get('multiplier', 0.0))
                partial_mult = band.get('partial_mult', full_mult * 0.45)

                display_multiplier = full_mult # Shows the maximum potential of the band on the UI

                # Select applied multiplier based on eligibility
                if full_bonus:
                    active_multiplier = full_mult
                elif collection_bonus_45:
                    active_multiplier = partial_mult
                else:
                    active_multiplier = 0.0

                # Next Band Opportunity
                if idx + 1 < len(bands):
                    next_b = bands[idx + 1]
                    
                    next_min = current_max + 1
                    next_max = next_b.get('max', float('inf'))
                    thresh = next_max if next_max != float('inf') else next_min
                    
                    cust_needed = next_min - customers if next_min > customers else 0

                    next_full_mult = next_b.get('full_mult', next_b.get('multiplier', 0.0))
                    next_partial_mult = next_b.get('partial_mult', next_full_mult * 0.45)

                    pot_bonus = 0.0
                    if full_bonus:
                        pot_bonus = salary * next_full_mult
                    elif collection_bonus_45:
                        pot_bonus = salary * next_partial_mult

                    curr_bonus = salary * active_multiplier
                    opp = pot_bonus - curr_bonus

                    min_thresh_math = 0 if idx == 0 else bands[idx - 1]['max']
                    denom = band['max'] - min_thresh_math
                    prog = ((customers - min_thresh_math) / denom * 100) if denom > 0 else 100
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

    # 3. Compute Base Bonus Payout using the Active Multiplier
    base_bonus = salary * active_multiplier

    # 4. Compute Founder's Collection Upside Bonus (Using DD+7)
    collection_upside = 0.0
    if full_bonus or collection_bonus_45:
        dd7_val = float(data.get('dd7', 0))
        disb_actual = float(data.get('disb_actual', 0))

        upside_config = config.get('collection_upside', {})
        if is_bm and pairs_clean in ["2", "3"]:
            upside_table = upside_config.get('bm_2_3pair', [])
        else:
            upside_table = upside_config.get('loco_1pair', [])

        target_row = None
        for row in upside_table:
            if row['min'] <= disb_actual <= row['max']:
                target_row = row
                break

        if not target_row and len(upside_table) > 0:
            target_row = upside_table[0]

        if target_row:
            best_payout = 0.0
            for thresh, amt in target_row['payouts'].items():
                if dd7_val >= (thresh - 0.0001):
                    if amt > best_payout:
                        best_payout = amt
            collection_upside = best_payout

    return {
        "eligibility": eligibility,
        "current": {
            "band": current_band,
            "min": current_min,
            "max": current_max,
            "multiplier": display_multiplier, 
            "customers": customers,
            "base_bonus": base_bonus
        },
        "next_band": next_band_info,
        "collection": {
            "upside": collection_upside
        }
    }

def evaluate_criteria(data, criteria_targets):
    results = []
    for key, target in criteria_targets.items():
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
    return bands[-1] # Fallback to highest

def get_next_band(customers, bands):
    for i, b in enumerate(bands):
        if customers <= b['max']:
            if i + 1 < len(bands) and bands[i+1]['max'] != float('inf'):
                return {"name": bands[i+1]['name'], "threshold": b['max'] + 1}
            elif i + 1 < len(bands) and bands[i+1]['max'] == float('inf'):
                # Handle Elite bounds
                return {"name": bands[i+1]['name'], "threshold": b['max'] + 1}
            return None
    return None

def calculate_base(salary, multiplier, full_bonus, col_bonus_passed):
    # As isolated based on prompt rule: if neither qualify, base is 0. 
    # If only 45% qualifies, base is scaled. (Customizable isolate formula)
    if full_bonus:
        return salary * multiplier
    elif col_bonus_passed:
        return (salary * multiplier) * 0.45
    return 0