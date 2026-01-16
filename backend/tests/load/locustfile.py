from locust import HttpUser, task, between, events
import random
import json
import time
from datetime import datetime

# Pre-created test users to avoid registration bottleneck
TEST_USERS = [
    {"email": f"test{i}@example.com", "password": "password123", "token": None}
    for i in range(100)
]

class TradingUser(HttpUser):
    wait_time = between(0.5, 1.5)  # Reduced wait time for higher throughput
    
    def on_start(self):
        """Initialize user session"""
        # Use pre-created test user
        self.user_data = random.choice(TEST_USERS)
        self.token = None
        self.assessment_id = None
        self.login()
        self.create_assessment()
    
    def login(self):
        """Login and get JWT token"""
        response = self.client.post(
            "/auth/login",
            json={
                "email": self.user_data["email"],
                "password": self.user_data["password"]
            },
            name="/auth/login"
        )
        if response.status_code == 200:
            try:
                self.token = response.json().get("token")
                self.user_data["token"] = self.token
            except:
                pass
    
    def create_assessment(self):
        """Create assessment for testing"""
        if not self.token:
            return
        
        response = self.client.post(
            "/assessments",
            headers={"Authorization": f"Bearer {self.token}"},
            json={"tier_id": "tier-1"},
            name="/assessments"
        )
        if response.status_code == 201:
            try:
                self.assessment_id = response.json().get("id")
            except:
                pass
    
    def get_headers(self):
        """Get authorization headers"""
        return {"Authorization": f"Bearer {self.token}"} if self.token else {}
    
    @task(20)
    def place_order(self):
        """Place trading order - 20x weight for high throughput"""
        if not self.assessment_id or not self.token:
            return
        
        markets = ["BTC/USD", "ETH/USD", "polymarket:event-123", "kalshi:event-456"]
        sides = ["long", "short", "yes", "no"]
        
        response = self.client.post(
            "/orders",
            headers=self.get_headers(),
            json={
                "assessment_id": self.assessment_id,
                "market": random.choice(markets),
                "side": random.choice(sides),
                "quantity": round(random.uniform(0.01, 0.1), 4)
            },
            name="/orders",
            timeout=5
        )
        
        if response.status_code not in [200, 201]:
            self.client.events.request.fire(
                request_type="POST",
                name="/orders",
                response_time=0,
                response_length=0,
                exception=Exception(f"Status {response.status_code}"),
                context={}
            )
    
    @task(5)
    def get_positions(self):
        """Get current positions - 5x weight"""
        if not self.assessment_id or not self.token:
            return
        
        self.client.get(
            f"/positions?assessment_id={self.assessment_id}",
            headers=self.get_headers(),
            name="/positions",
            timeout=5
        )
    
    @task(2)
    def get_assessment(self):
        """Get assessment details - 2x weight"""
        if not self.assessment_id or not self.token:
            return
        
        self.client.get(
            f"/assessments/{self.assessment_id}",
            headers=self.get_headers(),
            name="/assessments/:id",
            timeout=5
        )


class HighFrequencyTradingUser(HttpUser):
    """High frequency trading user - places orders rapidly"""
    wait_time = between(0.05, 0.2)  # Very short wait for HFT
    
    def on_start(self):
        self.user_data = random.choice(TEST_USERS)
        self.token = None
        self.assessment_id = None
        self.login()
        self.create_assessment()
    
    def login(self):
        response = self.client.post(
            "/auth/login",
            json={
                "email": self.user_data["email"],
                "password": self.user_data["password"]
            },
            name="/auth/login"
        )
        if response.status_code == 200:
            try:
                self.token = response.json().get("token")
            except:
                pass
    
    def create_assessment(self):
        if not self.token:
            return
        
        response = self.client.post(
            "/assessments",
            headers={"Authorization": f"Bearer {self.token}"},
            json={"tier_id": "tier-1"},
            name="/assessments"
        )
        if response.status_code == 201:
            try:
                self.assessment_id = response.json().get("id")
            except:
                pass
    
    def get_headers(self):
        return {"Authorization": f"Bearer {self.token}"} if self.token else {}
    
    @task(50)
    def place_order_rapid(self):
        """Place orders rapidly - 50x weight for HFT"""
        if not self.assessment_id or not self.token:
            return
        
        self.client.post(
            "/orders",
            headers=self.get_headers(),
            json={
                "assessment_id": self.assessment_id,
                "market": "BTC/USD",
                "side": random.choice(["long", "short"]),
                "quantity": round(random.uniform(0.01, 0.05), 4)
            },
            name="/orders",
            timeout=5
        )


@events.test_start.add_listener
def on_test_start(environment, **kwargs):
    """Called when load test starts"""
    print(f"\n{'='*60}")
    print(f"Load Test Started: {datetime.now().isoformat()}")
    print(f"Target: 10,000 orders/sec")
    print(f"Target Metrics: p99 <10ms, error rate <0.1%")
    print(f"{'='*60}\n")


@events.test_stop.add_listener
def on_test_stop(environment, **kwargs):
    """Called when load test stops"""
    print(f"\n{'='*60}")
    print(f"Load Test Stopped: {datetime.now().isoformat()}")
    print(f"{'='*60}\n")
    
    # Print summary statistics
    print("\nLoad Test Summary:")
    print(f"Total Requests: {environment.stats.total.num_requests}")
    print(f"Total Failures: {environment.stats.total.num_failures}")
    print(f"Failure Rate: {environment.stats.total.fail_ratio * 100:.2f}%")
    print(f"Average Response Time: {environment.stats.total.avg_response_time:.2f}ms")
    print(f"Min Response Time: {environment.stats.total.min_response_time:.2f}ms")
    print(f"Max Response Time: {environment.stats.total.max_response_time:.2f}ms")
    print(f"P50 Response Time: {environment.stats.total.get_response_time_percentile(0.5):.2f}ms")
    print(f"P95 Response Time: {environment.stats.total.get_response_time_percentile(0.95):.2f}ms")
    print(f"P99 Response Time: {environment.stats.total.get_response_time_percentile(0.99):.2f}ms")
    
    # Check if targets met
    p99_latency = environment.stats.total.get_response_time_percentile(0.99)
    error_rate = environment.stats.total.fail_ratio * 100
    
    print(f"\nTarget Verification:")
    print(f"P99 Latency Target: <10ms - {'✓ PASS' if p99_latency < 10 else '✗ FAIL'} ({p99_latency:.2f}ms)")
    print(f"Error Rate Target: <0.1% - {'✓ PASS' if error_rate < 0.1 else '✗ FAIL'} ({error_rate:.2f}%)")
    
    if p99_latency >= 10 or error_rate >= 0.1:
        print("\n⚠️  Performance targets NOT met!")
        exit(1)
    else:
        print("\n✓ All performance targets met!")
        exit(0)


@events.request.add_listener
def on_request(request_type, name, response_time, response_length, response, context, exception, **kwargs):
    """Called for each request"""
    if exception:
        print(f"Request failed: {name} - {exception}")
