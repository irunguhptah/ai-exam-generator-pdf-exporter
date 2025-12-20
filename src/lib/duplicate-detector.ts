// Duplicate detection utility for questions
// Shared between API and frontend to maintain consistency

// Helper: normalize text (lowercase, strip punctuation, collapse spaces)
const normalizeText = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[\p{P}$+<=>^`|~]/gu, "")
    .replace(/\s+/g, " ")
    .trim();

const tokenize = (s: string): string[] =>
  normalizeText(s)
    .split(/\s+/)
    .filter((w) => w.length > 2); // drop very short words

const jaccard = (a: string[], b: string[]): number => {
  const as = new Set(a);
  const bs = new Set(b);
  const intersection = [...as].filter((x) => bs.has(x)).length;
  const union = new Set([...as, ...bs]).size || 1;
  return intersection / union;
};

// Longest common subsequence ratio (approx) for fallback
const lcsRatio = (a: string, b: string): number => {
  const m = a.length;
  const n = b.length;
  if (m === 0 || n === 0) return 0;
  
  // use dynamic programming with rows sized by shorter string to save mem
  const s1 = a;
  const s2 = b;
  const dp = new Array(n + 1).fill(0);
  
  for (let i = 1; i <= m; i++) {
    let prev = 0;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      if (s1.charAt(i - 1) === s2.charAt(j - 1)) {
        dp[j] = prev + 1;
      } else {
        dp[j] = Math.max(dp[j], dp[j - 1]);
      }
      prev = temp;
    }
  }
  
  const lcsLen = dp[n];
  return lcsLen / Math.max(m, n);
};

// Semantic similarity check using edit distance
const editDistance = (a: string, b: string): number => {
  const m = a.length;
  const n = b.length;
  const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
  
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }
  
  return dp[m][n];
};

const editDistanceRatio = (a: string, b: string): number => {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 0;
  return 1 - (editDistance(a, b) / maxLen);
};

// Concept-level similarity using key term extraction
const extractKeyTerms = (text: string): Set<string> => {
  const normalized = normalizeText(text);
  const tokens = normalized.split(/\s+/).filter(w => w.length > 3);
  
  // Weight longer, more specific terms higher
  const keyTerms = new Set<string>();
  tokens.forEach(token => {
    if (token.length >= 5) keyTerms.add(token); // Important technical terms
  });
  
  return keyTerms;
};

const conceptSimilarity = (a: string, b: string): number => {
  const termsA = extractKeyTerms(a);
  const termsB = extractKeyTerms(b);
  
  if (termsA.size === 0 && termsB.size === 0) return 0;
  
  const intersection = [...termsA].filter(x => termsB.has(x)).length;
  const union = new Set([...termsA, ...termsB]).size;
  
  return union > 0 ? intersection / union : 0;
};

export interface DuplicationContext {
  questionLength?: 'short' | 'medium' | 'long';
  difficulty?: string;
  modelStrength?: 'weak' | 'medium' | 'strong';
  numQuestions?: number;
}

export const areSimilar = (a: string, b: string, context?: DuplicationContext): boolean => {
  if (!a || !b) return false;
  if (a === b) return true;
  
  // Calculate base similarity metrics
  const ta = tokenize(a);
  const tb = tokenize(b);
  const jaccardSim = jaccard(ta, tb);
  const lcsSim = lcsRatio(a, b);
  const editSim = editDistanceRatio(normalizeText(a), normalizeText(b));
  const conceptSim = conceptSimilarity(a, b);
  
  // Dynamic thresholds based on context
  let jaccardThreshold = 0.6;
  let lcsThreshold = 0.7;
  let editThreshold = 0.75;
  let conceptThreshold = 0.5;
  
  if (context) {
    // Adjust for question length (shorter questions = higher chance of duplicates)
    if (context.questionLength === 'short') {
      jaccardThreshold = 0.45; // More strict
      lcsThreshold = 0.6;
      editThreshold = 0.65;
      conceptThreshold = 0.4;
    } else if (context.questionLength === 'long') {
      jaccardThreshold = 0.7; // Less strict for longer questions
      lcsThreshold = 0.8;
      editThreshold = 0.85;
      conceptThreshold = 0.6;
    }
    
    // Adjust for difficulty (easier = more generic = higher duplication risk)
    if (context.difficulty === 'easy') {
      jaccardThreshold -= 0.1;
      lcsThreshold -= 0.1;
      editThreshold -= 0.1;
      conceptThreshold -= 0.1;
    } else if (context.difficulty === 'hard') {
      jaccardThreshold += 0.05;
      lcsThreshold += 0.05;
      editThreshold += 0.05;
      conceptThreshold += 0.05;
    }
    
    // Adjust for model strength (weaker models = more repetitive)
    if (context.modelStrength === 'weak') {
      jaccardThreshold -= 0.15;
      lcsThreshold -= 0.15;
      editThreshold -= 0.15;
      conceptThreshold -= 0.1;
    } else if (context.modelStrength === 'strong') {
      jaccardThreshold += 0.05;
      lcsThreshold += 0.05;
      editThreshold += 0.05;
      conceptThreshold += 0.05;
    }
    
    // Adjust for high question counts - be LESS strict for large sets to avoid false positives
    if (context.numQuestions && context.numQuestions > 50) {
      // For large question sets, increase thresholds to reduce false positives
      const adjustment = Math.min(0.15, (context.numQuestions - 50) / 300);
      jaccardThreshold += adjustment;
      lcsThreshold += adjustment;
      editThreshold += adjustment;
      conceptThreshold += adjustment;
      
      console.log(`🔧 Large question set (${context.numQuestions}): Relaxed thresholds by ${adjustment.toFixed(3)}`);
    }
  }
  
  // Ensure thresholds stay within reasonable bounds
  jaccardThreshold = Math.max(0.2, Math.min(0.85, jaccardThreshold));
  lcsThreshold = Math.max(0.3, Math.min(0.9, lcsThreshold));
  editThreshold = Math.max(0.4, Math.min(0.95, editThreshold));
  conceptThreshold = Math.max(0.2, Math.min(0.8, conceptThreshold));
  
  // Multi-metric similarity check
  const similarityChecks = [
    jaccardSim >= jaccardThreshold,
    lcsSim >= lcsThreshold,
    editSim >= editThreshold,
    conceptSim >= conceptThreshold
  ];
  
  // For high-risk contexts, require fewer metrics to trigger similarity
  const requiredMatches = context && 
    (context.questionLength === 'short' || 
     context.difficulty === 'easy' || 
     context.modelStrength === 'weak') ? 1 : 2;
  
  const matchCount = similarityChecks.filter(Boolean).length;
  
  return matchCount >= requiredMatches;
};

export interface Question {
  questionText: string;
  questionType: string;
  optionA?: string | null;
  optionB?: string | null;
  optionC?: string | null;
  optionD?: string | null;
  correctAnswer: string;
  rationale?: string | null;
  points?: number;
  orderIndex?: number;
}

export const removeDuplicates = (
  questions: Question[], 
  context?: DuplicationContext
): { unique: Question[], duplicatesRemoved: number } => {
  const uniqueQuestions: Question[] = [];
  let duplicatesCount = 0;
  
  for (const question of questions) {
    const text = (question.questionText || "").toString().trim();
    const norm = normalizeText(text);
    let isDuplicate = false;
    
    for (const uniqueQuestion of uniqueQuestions) {
      const uniqueText = (uniqueQuestion.questionText || "").toString().trim();
      if (areSimilar(norm, normalizeText(uniqueText), context)) {
        isDuplicate = true;
        duplicatesCount++;
        break;
      }
    }
    
    if (!isDuplicate) {
      uniqueQuestions.push(question);
    }
  }
  
  return {
    unique: uniqueQuestions,
    duplicatesRemoved: duplicatesCount
  };
};

export default {
  areSimilar,
  removeDuplicates,
  normalizeText
};