# tests/test_bonus_engine.py
import pytest
from services.bonus_engine import calculate_bonus

@pytest.fixture
def base_config():
    return {
        "criteria": {
            "disbursement": 0.98,
            "active_customers": 0.95,
            "new_customers": 0.95,
            "otc": 0.915,
            "dd7": 0.94,
            "new_customer_otc": 0.90
        },
        "loco_bands": [
            {"name": "Floor", "max": 200, "full_mult": 0.10},
            {"name": "Baseline", "max": 350, "full_mult": 0.15}
        ]
    }

def test_partial_bonus_disbursement_floor(base_config):
    # Staff hits OTC & DD7 but disbursement is 94% (< 95% floor) -> Should Miss
    data = {
        "employee_type": "LOCO",
        "salary": 29108.0,
        "customers": 150,
        "disbursement": 0.94,
        "active_customers": 0.96,
        "new_customers": 0.96,
        "otc": 0.92,
        "dd7": 0.95,
        "new_customer_otc": 0.91,
        "month": "202608"
    }
    result = calculate_bonus(data, base_config)
    assert result["eligibility"]["full_bonus"] is False
    assert result["eligibility"]["collection_bonus_45"] is False

def test_partial_bonus_qualification(base_config):
    # Staff hits OTC & DD7 and disbursement is 95% (>= 95% floor) -> Should get 45% bonus
    data = {
        "employee_type": "LOCO",
        "salary": 29108.0,
        "customers": 150,
        "disbursement": 0.95,
        "active_customers": 0.90,  # Fails full sales
        "new_customers": 0.90,
        "otc": 0.92,
        "dd7": 0.95,
        "new_customer_otc": 0.91,
        "month": "202608"
    }
    result = calculate_bonus(data, base_config)
    assert result["eligibility"]["full_bonus"] is False
    assert result["eligibility"]["collection_bonus_45"] is True