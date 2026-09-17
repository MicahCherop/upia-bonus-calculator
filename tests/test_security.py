# tests/test_security.py
import pytest
from app import app

@pytest.fixture
def client():
    app.config['TESTING'] = True
    app.config['SECRET_KEY'] = 'security-test-key-123'
    with app.test_client() as client:
        yield client

# 1. TEST: Unauthenticated requests are blocked
def test_unauthenticated_access_blocked(client):
    response = client.get('/api/performance/3053')
    assert response.status_code == 401
    assert response.json['error'] == 'Unauthenticated'

# 2. TEST: IDOR Prevention — LOCO cannot view another staff member's record
def test_idor_loco_access_blocked(client):
    with client.session_transaction() as sess:
        sess['user'] = {
            'id': '1001',
            'type': 'LOCO',
            'name': 'Malicious User'
        }

    # Staff 1001 attempts to access Charity's record (3053)
    response = client.get('/api/performance/3053')
    assert response.status_code == 403
    assert 'Unauthorized access' in response.json['error']

# 3. TEST: Legitimate Access — LOCO can access their own record
def test_loco_can_access_own_record(client):
    with client.session_transaction() as sess:
        sess['user'] = {
            'id': '3053',
            'type': 'LOCO',
            'name': 'Charity Gakii'
        }

    response = client.get('/api/performance/3053')
    # Should not trigger 401 (Unauthenticated) or 403 (Forbidden)
    assert response.status_code in [200, 404]

# 4. TEST: Session Cookie Security Flags
def test_session_cookie_headers(client):
    response = client.get('/')
    # Verify HttpOnly flag prevents XSS cookie theft
    cookie_header = response.headers.get('Set-Cookie', '')
    assert 'HttpOnly' in cookie_header or app.config['SESSION_COOKIE_HTTPONLY'] is True