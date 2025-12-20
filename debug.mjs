import { auth } from "./src/lib/auth.js";
import { db } from "./src/db/index.js";
import { exams, questions } from "./src/db/schema.js";

async function debugDatabase() {
  try {
    console.log("🔍 Debugging database and authentication...");

    // Test database connection
    const testQuery = await db.select().from(exams).limit(1);
    console.log("✅ Database connection successful");

    // Count records
    const examCount = await db.select().from(exams);
    const questionCount = await db.select().from(questions);

    console.log(`📊 Total exams: ${examCount.length}`);
    console.log(`❓ Total questions: ${questionCount.length}`);

    if (examCount.length > 0) {
      console.log("📝 Sample exams:");
      examCount.slice(0, 3).forEach((exam) => {
        console.log(
          `  - ${exam.title} (${exam.subject}) - ${exam.numQuestions} questions`
        );
      });
    } else {
      console.log("⚠️  No exams found in database");
    }
  } catch (error) {
    console.error("❌ Error:", error.message);
  }
}

debugDatabase();
