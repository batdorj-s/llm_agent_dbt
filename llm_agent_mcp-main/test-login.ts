async function testFull() {
    console.log("--- 1. Testing Login API ---");
    let token = "";
    try {
        const res = await fetch("http://localhost:3001/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: "admin@enterprise.com", password: "password123" }),
        });

        const data = await res.json() as any;
        console.log("Login Status:", res.status);
        token = data.token;
    } catch (err) {
        console.error("Login Failed:", err);
        return;
    }

    console.log("\n--- 2. Testing KPI API ---");
    try {
        const res = await fetch("http://localhost:3001/api/kpi/sales", {
            headers: { "Authorization": `Bearer ${token}` },
        });
        console.log("KPI Status:", res.status);
        const data = await res.json();
        console.log("KPI Response:", JSON.stringify(data, null, 2));
    } catch (err) {
        console.error("KPI Failed:", err);
    }

    console.log("\n--- 3. Testing Files API ---");
    try {
        const res = await fetch("http://localhost:3001/api/admin/files", {
            headers: { "Authorization": `Bearer ${token}` },
        });
        console.log("Files Status:", res.status);
        const data = await res.json();
        console.log("Files Response:", JSON.stringify(data, null, 2));
    } catch (err) {
        console.error("Files Failed:", err);
    }
}

testFull();
