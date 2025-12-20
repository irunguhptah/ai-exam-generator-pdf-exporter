const { createClient } = require("@libsql/client");

async function testConnection() {
  try {
    console.log("Testing database connection...");

    const client = createClient({
      url:
        process.env.TURSO_CONNECTION_URL ||
        "libsql://exam-generator-db-ptah.aws-us-east-1.turso.io",
      authToken:
        process.env.TURSO_AUTH_TOKEN ||
        "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3NTk3MDAxOTMsImlkIjoiMDdjMmQyN2ItODc4MC00YzAwLTk1YTYtMTc3MjQwNmQxZDhkIiwicmlkIjoiOWZiODMwNzItMWVjMC00M2M1LTljMzEtOWM0ZTUyYTYwYTdmIn0.VLvPdvCYkoutkbGLaDDMjRw28bnhmWheUcr-W-e2zPo5tO6s-WCPKGZFhBKkp2OG_0gqmpem86_5pW9k0wiVAQ",
    });

    // Test basic connection
    const result = await client.execute("SELECT 1 as test");
    console.log("✅ Database connection successful:", result);

    // Check if tables exist
    const tables = await client.execute(`
      SELECT name FROM sqlite_schema 
      WHERE type='table' 
      ORDER BY name;
    `);
    console.log(
      "📋 Tables in database:",
      tables.rows.map((row) => row.name)
    );

    // Check exams table
    const examsCount = await client.execute(
      "SELECT COUNT(*) as count FROM exams"
    );
    console.log("📊 Exams in database:", examsCount.rows[0].count);

    // Check questions table
    const questionsCount = await client.execute(
      "SELECT COUNT(*) as count FROM questions"
    );
    console.log("❓ Questions in database:", questionsCount.rows[0].count);

    // Check users table
    const usersCount = await client.execute(
      "SELECT COUNT(*) as count FROM user"
    );
    console.log("👤 Users in database:", usersCount.rows[0].count);

    // Get sample data
    const sampleExams = await client.execute("SELECT * FROM exams LIMIT 3");
    console.log("📝 Sample exams:", sampleExams.rows);
  } catch (error) {
    console.error("❌ Database connection failed:", error);
  }
}

testConnection();
