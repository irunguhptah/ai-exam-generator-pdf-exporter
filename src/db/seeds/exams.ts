import { db } from '@/db';
import { exams } from '@/db/schema';

async function main() {
    const sampleExams = [
        {
            userId: 'user_001',
            title: 'Biology Mid-term',
            subject: 'Biology',
            difficulty: 'medium',
            numQuestions: 8,
            createdAt: new Date('2024-01-15T10:30:00Z').toISOString(),
        },
        {
            userId: 'user_002',
            title: 'World History Quiz',
            subject: 'History',
            difficulty: 'easy',
            numQuestions: 6,
            createdAt: new Date('2024-01-18T14:20:00Z').toISOString(),
        },
        {
            userId: 'user_001',
            title: 'Advanced Mathematics',
            subject: 'Mathematics',
            difficulty: 'hard',
            numQuestions: 10,
            createdAt: new Date('2024-01-22T09:15:00Z').toISOString(),
        },
        {
            userId: 'user_003',
            title: 'Computer Science Fundamentals',
            subject: 'Computer Science',
            difficulty: 'medium',
            numQuestions: 7,
            createdAt: new Date('2024-01-25T11:45:00Z').toISOString(),
        },
        {
            userId: 'user_002',
            title: 'Chemistry Final',
            subject: 'Chemistry',
            difficulty: 'hard',
            numQuestions: 9,
            createdAt: new Date('2024-01-28T13:00:00Z').toISOString(),
        }
    ];

    await db.insert(exams).values(sampleExams);
    
    console.log('✅ Exams seeder completed successfully');
}

main().catch((error) => {
    console.error('❌ Seeder failed:', error);
});