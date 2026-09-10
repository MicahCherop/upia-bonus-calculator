import csv
import io
import re
import urllib.parse
import urllib.request

def fetch_csv_rows(sheet_id, sheet_name):
    encoded_name = urllib.parse.quote(sheet_name)
    url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/gviz/tq?tqx=out:csv&sheet={encoded_name}"
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=10) as resp:
            content = resp.read().decode('utf-8')
        return list(csv.reader(io.StringIO(content)))
    except Exception as e:
        print(f"Error fetching sheet {sheet_name}: {e}")
        return []

def load_configuration(sheet_id):
    try:
        config = {
            "criteria": _parse_criteria(),
            "loco_bands": _parse_bands(),
            "bm_bands": _parse_bm_bands(),
            "collection_upside": _parse_collections(fetch_csv_rows(sheet_id, 'Collections upside')),
            "staff": _parse_staff_list(fetch_csv_rows(sheet_id, 'Staff_List')),
            "performance": _parse_performance(fetch_csv_rows(sheet_id, 'Performance'))
        }
        return config
    except Exception as e:
        print(f"Error reading Google Sheet config: {e}")
        return _get_fallback_config()

def _parse_criteria():
    return {
        "disbursement": 0.98,
        "active_customers": 0.95,
        "new_customers": 0.95,
        "otc": 0.915,
        "dd7": 0.94,
        "new_customer_otc": 0.90
    }

def _parse_bands():
    return [
        {"max": 200, "name": "Floor", "multiplier": 0.80},
        {"max": 350, "name": "Baseline", "multiplier": 1.20},
        {"max": 450, "name": "Growth", "multiplier": 1.60},
        {"max": 499, "name": "Tension", "multiplier": 1.80},
        {"max": float('inf'), "name": "Elite", "multiplier": 2.20}
    ]

def _parse_bm_bands():
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

def _parse_collections(rows):
    thresholds = [0.945, 0.950, 0.955, 0.960, 0.965, 0.970, 0.975, 0.980, 0.985, 0.990, 0.995, 1.000]
    loco_1pair = []
    bm_2_3pair = []

    if not rows or len(rows) < 2:
        return {"loco_1pair": [], "bm_2_3pair": []}

    for row in rows[1:]:
        if not row: continue
        col_a = str(row[0]).strip().lower() if len(row) > 0 else ""

        def extract_payouts(r):
            payouts = {}
            for i, thresh in enumerate(thresholds):
                col_idx = i + 1
                if len(r) > col_idx:
                    val = r[col_idx]
                    try:
                        v_str = str(val).replace(',', '').replace('KES', '').strip()
                        payouts[thresh] = float(v_str)
                    except (ValueError, TypeError):
                        payouts[thresh] = 0.0
                else:
                    payouts[thresh] = 0.0
            return payouts

        payouts = extract_payouts(row)
        if "<5m" in col_a: loco_1pair.append({"min": 0, "max": 4999999.99, "payouts": payouts})
        elif "5-7m" in col_a: loco_1pair.append({"min": 5000000, "max": 6999999.99, "payouts": payouts})
        elif "7-10m" in col_a: loco_1pair.append({"min": 7000000, "max": 9999999.99, "payouts": payouts})
        elif "10-15m" in col_a: loco_1pair.append({"min": 10000000, "max": 14999999.99, "payouts": payouts})
        elif "15m+" in col_a: loco_1pair.append({"min": 15000000, "max": float('inf'), "payouts": payouts})
        elif "<10m" in col_a: bm_2_3pair.append({"min": 0, "max": 9999999.99, "payouts": payouts})
        elif "10-14m" in col_a: bm_2_3pair.append({"min": 10000000, "max": 13999999.99, "payouts": payouts})
        elif "14-20m" in col_a: bm_2_3pair.append({"min": 14000000, "max": 19999999.99, "payouts": payouts})
        elif "20-30m" in col_a: bm_2_3pair.append({"min": 20000000, "max": 29999999.99, "payouts": payouts})
        elif "30m+" in col_a: bm_2_3pair.append({"min": 30000000, "max": float('inf'), "payouts": payouts})

    return {"loco_1pair": loco_1pair, "bm_2_3pair": bm_2_3pair}

def _get_fallback_config():
    return {
        "criteria": _parse_criteria(),
        "loco_bands": _parse_bands(),
        "bm_bands": _parse_bm_bands(),
        "collection_upside": {"loco_1pair": [], "bm_2_3pair": []},
        "staff": {}, "performance": {}
    }

def _parse_staff_list(rows):
    employees = {}
    if not rows or len(rows) < 2:
        return employees
    for row in rows[1:]:
        try:
            if len(row) > 2:
                email = str(row[2]).strip().lower()
                if email and email != 'nan' and '@' in email:
                    employees[email] = {
                        "branch": str(row[0]).strip() if len(row) > 0 else "",
                        "name": str(row[1]).strip() if len(row) > 1 else "",
                        "email": email,
                        "pairs": str(row[3]).strip() if len(row) > 3 else "1",
                        "type": str(row[4]).strip() if len(row) > 4 else "",
                        "id": str(row[5]).strip() if len(row) > 5 else "N/A"
                    }
        except Exception:
            continue
    return employees

def _normalize_month_code(raw_val):
    if raw_val is None: return ""
    s = str(raw_val).strip()
    if '.' in s: s = s.split('.')[0]
    digits = re.sub(r'\D', '', s)
    if len(digits) >= 6: return digits[:6]
    return s.lower()

def _parse_performance(rows):
    perf_records = {}
    if not rows or len(rows) < 2:
        return perf_records

    headers = [str(c).strip().lower() for c in rows[0]]
    data_rows = rows[1:]

    # Forward fill state for first 4 columns (fixes Google Sheets merged cells)
    last_seen = ["", "", "", ""]

    for row in data_rows:
        try:
            if not row: continue

            while len(row) < len(headers):
                row.append("")

            # Forward fill merged cells
            for col_idx in range(min(4, len(row))):
                val = str(row[col_idx]).strip()
                if val and val.lower() not in ['nan', 'null', '']:
                    last_seen[col_idx] = val
                else:
                    row[col_idx] = last_seen[col_idx]

            month_code = _normalize_month_code(row[0])
            branch = str(row[2]).strip().lower()
            pair = str(row[3]).strip().lower()

            if month_code and branch and pair and month_code != 'nan':

                def _clean_float(val):
                    if val is None: return 0.0
                    try:
                        v_str = str(val).strip().replace('%', '').replace(',', '').replace('KES', '')
                        if v_str.lower() in ['-', '', 'nan', '#n/a', '#ref!', '#value!', 'null', 'none']:
                            return 0.0
                        return float(v_str)
                    except Exception:
                        return 0.0

                def get_val(possible_keywords, col_idx):
                    for kw in possible_keywords:
                        for idx, col_name in enumerate(headers):
                            if kw in col_name:
                                v = row[idx]
                                if v is not None and str(v).strip() != '':
                                    return _clean_float(v)
                    if len(row) > col_idx:
                        v = row[col_idx]
                        if v is not None and str(v).strip() != '':
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
            print(f"Skipping performance row: {e}")
            continue

    return perf_records