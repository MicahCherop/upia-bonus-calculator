import pandas as pd
import urllib.parse
import re

def get_sheet_csv_url(sheet_id, sheet_name):
    encoded_name = urllib.parse.quote(sheet_name)
    url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/gviz/tq?tqx=out:csv&sheet={encoded_name}"
    print(f"DEBUG: Trying to fetch -> {url}") 
    return url

def load_configuration(sheet_id):
    try:
        config = {
            "criteria": _parse_criteria(pd.read_csv(get_sheet_csv_url(sheet_id, 'Criteria'))),
            "loco_bands": _parse_bands(pd.read_csv(get_sheet_csv_url(sheet_id, 'LOCO Pairs'))),
            "bm_bands": _parse_bm_bands(pd.read_csv(get_sheet_csv_url(sheet_id, 'BM'))),
            "collection_upside": _parse_collections(pd.read_csv(get_sheet_csv_url(sheet_id, 'Collections upside'))),
            "staff": _parse_staff_list(pd.read_csv(get_sheet_csv_url(sheet_id, 'Staff_List'))),
            "performance": _parse_performance(pd.read_csv(get_sheet_csv_url(sheet_id, 'Performance')))
        }
        return config
    except Exception as e:
        print(f"Error reading Google Sheet config: {e}")
        return _get_fallback_config()

def _parse_criteria(df):
    return {
        "disbursement": 0.98,
        "active_customers": 0.95,
        "new_customers": 0.95,
        "otc": 0.915,
        "dd7": 0.94,
        "new_customer_otc": 0.90
    }

def _parse_bands(df):
    return [
        {"max": 200, "name": "Floor", "multiplier": 0.80},
        {"max": 350, "name": "Baseline", "multiplier": 1.20},
        {"max": 450, "name": "Growth", "multiplier": 1.60},
        {"max": 499, "name": "Tension", "multiplier": 1.80},
        {"max": float('inf'), "name": "Elite", "multiplier": 2.20}
    ]

def _parse_bm_bands(df):
    return {
        "1": [
            {"max": 200, "name": "Floor", "full_mult": 0.30, "partial_mult": 0.25},
            {"max": 350, "name": "Baseline", "full_mult": 0.90, "partial_mult": 0.30},
            {"max": 450, "name": "Growth", "full_mult": 1.30, "partial_mult": 0.40},
            {"max": 550, "name": "Tension", "full_mult": 1.60, "partial_mult": 0.45},
            {"max": 650, "name": "Pre-Elite", "full_mult": 1.75, "partial_mult": 0.50},
            {"max": float('inf'), "name": "Elite", "full_mult": 2.00, "partial_mult": 0.55}
        ],
        "2": [
            {"max": 400, "name": "Floor", "full_mult": 0.20, "partial_mult": 0.25},
            {"max": 700, "name": "Baseline", "full_mult": 0.80, "partial_mult": 0.30},
            {"max": 900, "name": "Growth", "full_mult": 1.30, "partial_mult": 0.40},
            {"max": 1100, "name": "Tension", "full_mult": 1.60, "partial_mult": 0.45},
            {"max": 1300, "name": "Pre-Elite", "full_mult": 1.75, "partial_mult": 0.50},
            {"max": float('inf'), "name": "Elite", "full_mult": 2.00, "partial_mult": 0.55}
        ],
        "3": [
            {"max": 600, "name": "Floor", "full_mult": 0.20, "partial_mult": 0.25},
            {"max": 900, "name": "Baseline", "full_mult": 0.75, "partial_mult": 0.30},
            {"max": 1200, "name": "Growth", "full_mult": 1.30, "partial_mult": 0.40},
            {"max": 1500, "name": "Tension", "full_mult": 1.60, "partial_mult": 0.45},
            {"max": 1800, "name": "Pre-Elite", "full_mult": 1.75, "partial_mult": 0.50},
            {"max": float('inf'), "name": "Elite", "full_mult": 2.00, "partial_mult": 0.55}
        ]
    }

def _parse_collections(df):
    thresholds = [0.945, 0.950, 0.955, 0.960, 0.965, 0.970, 0.975, 0.980, 0.985, 0.990, 0.995, 1.000]
    loco_1pair = []
    bm_2_3pair = []

    if df is not None and not df.empty:
        for index, row in df.iterrows():
            col_a = str(row.iloc[0]).strip().lower() if len(row) > 0 else ""

            def extract_payouts(r):
                payouts = {}
                for i, thresh in enumerate(thresholds):
                    col_idx = i + 1
                    if len(r) > col_idx:
                        val = r.iloc[col_idx]
                        try:
                            if isinstance(val, str):
                                val = val.replace(',', '').replace('KES', '').strip()
                            payouts[thresh] = float(val)
                        except (ValueError, TypeError):
                            payouts[thresh] = 0.0
                    else:
                        payouts[thresh] = 0.0
                return payouts

            if "<5m" in col_a: loco_1pair.append({"min": 0, "max": 4999999.99, "payouts": extract_payouts(row)})
            elif "5-7m" in col_a: loco_1pair.append({"min": 5000000, "max": 6999999.99, "payouts": extract_payouts(row)})
            elif "7-10m" in col_a: loco_1pair.append({"min": 7000000, "max": 9999999.99, "payouts": extract_payouts(row)})
            elif "10-15m" in col_a: loco_1pair.append({"min": 10000000, "max": 14999999.99, "payouts": extract_payouts(row)})
            elif "15m+" in col_a: loco_1pair.append({"min": 15000000, "max": float('inf'), "payouts": extract_payouts(row)})
            elif "<10m" in col_a: bm_2_3pair.append({"min": 0, "max": 9999999.99, "payouts": extract_payouts(row)})
            elif "10-14m" in col_a: bm_2_3pair.append({"min": 10000000, "max": 13999999.99, "payouts": extract_payouts(row)})
            elif "14-20m" in col_a: bm_2_3pair.append({"min": 14000000, "max": 19999999.99, "payouts": extract_payouts(row)})
            elif "20-30m" in col_a: bm_2_3pair.append({"min": 20000000, "max": 29999999.99, "payouts": extract_payouts(row)})
            elif "30m+" in col_a: bm_2_3pair.append({"min": 30000000, "max": float('inf'), "payouts": extract_payouts(row)})

    return {"loco_1pair": loco_1pair, "bm_2_3pair": bm_2_3pair}

def _get_fallback_config():
    return {
        "criteria": _parse_criteria(None),
        "loco_bands": _parse_bands(None),
        "bm_bands": _parse_bm_bands(None),
        "collection_upside": {"loco_1pair": [], "bm_2_3pair": []},
        "staff": {}, "performance": {}
    }

def _parse_staff_list(df):
    employees = {}
    if df is not None and not df.empty:
        for index, row in df.iterrows():
            try:
                if len(row) > 2:
                    email = str(row.iloc[2]).strip().lower()
                    if email and email != 'nan' and '@' in email:
                        employees[email] = {
                            "branch": str(row.iloc[0]).strip() if len(row) > 0 else "",
                            "name": str(row.iloc[1]).strip() if len(row) > 1 else "",
                            "email": email,
                            "pairs": str(row.iloc[3]).strip() if len(row) > 3 else "1",
                            "type": str(row.iloc[4]).strip() if len(row) > 4 else "",
                            "id": str(row.iloc[5]).strip() if len(row) > 5 else "N/A"
                        }
            except Exception as e:
                continue
    return employees

def _normalize_month_code(raw_val):
    if pd.isna(raw_val): return ""
    s = str(raw_val).strip()
    if '.' in s: s = s.split('.')[0]
    digits = re.sub(r'\D', '', s)
    if len(digits) >= 6: return digits[:6]
    return s.lower()

def _parse_performance(df):
    perf_records = {}
    if df is not None and not df.empty:
        
        print(f"\n=== PERFORMANCE TAB X-RAY ===")
        print(f"HEADERS: {df.columns.tolist()[:6]}")
        
        # Forward fill the first 4 columns to fix Merged Cells
        for col in df.columns[:4]:
            df[col] = df[col].ffill()
            
        # Print all unique values Pandas sees in the first 4 columns
        print(f"COL A (Index 0) Data: {df.iloc[:, 0].astype(str).unique().tolist()[:10]}")
        print(f"COL B (Index 1) Data: {df.iloc[:, 1].astype(str).unique().tolist()[:10]}")
        print(f"COL C (Index 2) Data: {df.iloc[:, 2].astype(str).unique().tolist()[:10]}")
        print(f"COL D (Index 3) Data: {df.iloc[:, 3].astype(str).unique().tolist()[:10]}")
        print(f"=============================\n")
            
        cols_lower = [str(c).strip().lower() for c in df.columns]
        
        for index, row in df.iterrows():
            try:
                if len(row) >= 4:
                    month_code = _normalize_month_code(row.iloc[0]) # Col A
                    branch = str(row.iloc[2]).strip().lower()       # Col C
                    pair = str(row.iloc[3]).strip().lower()         # Col D

                    if month_code and branch and pair and month_code != 'nan':
                        
                        def _clean_float(val):
                            if pd.isna(val): return 0.0
                            try:
                                if isinstance(val, str):
                                    val = val.strip().replace('%', '').replace(',', '').replace('KES', '')
                                    if val.lower() in ['-', '', 'nan', '#n/a', '#ref!', '#value!', 'null', 'none']:
                                        return 0.0
                                return float(val)
                            except Exception:
                                return 0.0

                        def get_val(possible_keywords, col_idx):
                            for kw in possible_keywords:
                                for idx, col_name in enumerate(cols_lower):
                                    if kw in col_name:
                                        v = row.iloc[idx]
                                        if not pd.isna(v) and str(v).strip() != '':
                                            return _clean_float(v)
                            if len(row) > col_idx:
                                v = row.iloc[col_idx]
                                if not pd.isna(v) and str(v).strip() != '':
                                    return _clean_float(v)
                            return 0.0

                        lookup_key = f"{branch}_{pair}_{month_code}"
                        perf_records[lookup_key] = {
                            "disb_target": get_val(["disb target"], 4),
                            "disb_actual": get_val(["disb amnt"], 5),
                            "disb_rate": get_val(["disb rate"], 6),
                            "ac_target": get_val(["ac target"], 7),
                            "ac_actual": get_val(["ac actual"], 8),
                            "ac_rate": get_val(["ac rate"], 9),
                            "nc_target": get_val(["nc target"], 13),
                            "nc_actual": get_val(["nc actual"], 14),
                            "nc_rate": get_val(["nc rate"], 15),
                            "overall_otc": get_val(["ovrll otc", "overall otc"], 16),
                            "dd7_rate": get_val(["dd7 rate", "dd7"], 19),
                            "new_customer_otc": get_val(["new customer", "nc otc", "new cust otc"], 21)
                        }
            except Exception as e:
                continue
    return perf_records