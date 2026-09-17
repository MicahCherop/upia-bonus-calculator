from locust import HttpUser, task, between

class BonusCalculatorUser(HttpUser):
    wait_time = between(1, 3)  # Simulates realistic user click delay

    @task(3)
    def calculate_single_bonus(self):
        payload = {
            "salary": 45000,
            "customers": 320,
            "branch": "Nairobi"
        }
        self.client.post("/api/calculate", json=payload)

    @task(1)
    def fetch_performance_metrics(self):
        self.client.get("/api/admin/metrics")