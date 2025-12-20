import Groq from 'groq-sdk';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

/**
 * Generate a concise list of topics covered by exam questions.
 * Prefer using Groq chat completion; fall back to simple heuristic extraction.
 * Returns an array of short strings (max ~6 words each), up to 8 items.
 */
export async function getExamTopicsFromGroq(questions: any[]): Promise<string[]> {
  const texts = (questions || []).map((q: any) => q.questionText || q.question || '').filter(Boolean).slice(0, 30);
  if (texts.length === 0) return [];

  try {
    const completion = await groq.chat.completions.create({
      model: 'openai/gpt-oss-20b',
      messages: [
        { role: 'system' as const, content: 'You are an assistant that summarizes exam questions into a short list of concise topic phrases (3-6 words each). Return a JSON array of strings, no extra commentary.' },
        { role: 'user' as const, content: `Generate 5-8 short topics (3-6 words each) that best summarize the following exam questions. Return ONLY a JSON array of strings.\n\nQuestions:\n${texts.join('\n\n')}` }
      ],
      max_tokens: 300,
      temperature: 0.3,
    });

    const raw = (completion as any)?.choices?.[0]?.message?.content || '';
    // Try to parse JSON from response
    let topics: string[] = [];
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) topics = parsed.map((s: any) => String(s));
    } catch (e) {
      // Fallback: extract lines
      topics = raw.split(/\r?\n/).map((s: string) => s.trim()).filter(Boolean).map((s: string) => s.replace(/^[\-\d\.\)\s]+/, ''));
    }

    // Normalize and limit
    topics = topics.map(t => t.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 8).map(t => {
      const words = t.split(' ');
      return words.length > 6 ? words.slice(0, 6).join(' ') : t;
    });

    return topics;
  } catch (err) {
    // Heuristic fallback: extract common short phrases from questions
    try {
      const phraseCounts: Record<string, number> = {};
      for (const t of texts) {
        const words = t.replace(/[\W_]+/g, ' ').toLowerCase().split(/\s+/).filter(Boolean);
        for (let i = 0; i < Math.min(words.length, 8); i++) {
          for (let len = 2; len <= 6; len++) {
            const slice = words.slice(i, i + len);
            if (slice.length < 2) continue;
            const phrase = slice.join(' ');
            phraseCounts[phrase] = (phraseCounts[phrase] || 0) + 1;
          }
        }
      }
      const sorted = Object.entries(phraseCounts).sort((a, b) => b[1] - a[1]).map(e => e[0]);
      const unique = Array.from(new Set(sorted)).slice(0, 8).map(s => s.split(' ').slice(0, 6).join(' '));
      return unique;
    } catch (err2) {
      return [];
    }
  }
}
