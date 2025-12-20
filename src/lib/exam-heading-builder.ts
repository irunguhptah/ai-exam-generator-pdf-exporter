/**
 * Reusable helper for building attractive exam headings for PDF exports
 */

export interface ExamHeadingOptions {
  examTitle: string;          // e.g. "GCSU BACHOON Microbiology Final Exam"
  collegeName?: string;       // e.g. "Georgia College & State University"
  subject?: string;           // e.g. "Microbiology"
  level?: string;             // e.g. "Undergraduate", "Nursing", "Pre-Med"
  questionCount?: number;     // optional, for marketing ("Over 120 MCQs")
  startYear?: number;         // academic year start
  endYear?: number;           // academic year end
}

export interface ExamHeading {
  mainLine: string;
  subLine: string;
}

/**
 * Internal helper to build marketing sublines with variety
 */
function buildMarketingSubline(options: {
  subject?: string;
  level?: string;
  questionCount?: number;
  collegeName?: string;
}): string {
  const { subject, level, questionCount, collegeName } = options;
  
  // Starting phrase - always professional and attractive
  const openingPhrases = [
    "Actual Exam with Complete Questions & Fully Worked Solutions",
    "Official Exam Questions with Comprehensive Answer Keys",
    "Complete Exam Package with Detailed Explanations",
    "Authentic Assessment with Full Solution Guide"
  ];
  
  // Use a deterministic selection based on subject length to avoid randomness
  const openingIndex = subject ? subject.length % openingPhrases.length : 0;
  let subLine = openingPhrases[openingIndex];
  
  // Add college name if provided
  if (collegeName) {
    subLine += ` | ${collegeName}`;
  }
  
  // Build closing phrase with available info
  const closingParts: string[] = [];
  
  if (subject && level) {
    closingParts.push(`**Comprehensive ${subject} Assessment** for **${level} Students**`);
  } else if (subject) {
    closingParts.push(`**High-Yield ${subject} Review**`);
  } else if (level) {
    closingParts.push(`**Professional ${level} Certification Prep**`);
  }
  
  if (questionCount && questionCount > 0) {
    if (questionCount >= 100) {
      closingParts.push(`**Over ${questionCount} Exam-Style Questions**`);
    } else if (questionCount >= 50) {
      closingParts.push(`**${questionCount}+ Premium Practice Questions**`);
    } else {
      closingParts.push(`**${questionCount} Carefully Crafted Questions**`);
    }
  }
  
  // Add a default attractive closing if we don't have specific info
  if (closingParts.length === 0) {
    closingParts.push("**Premium Academic Assessment Package**");
  }
  
  // Join closing parts
  const closingPhrase = closingParts.join(" | ");
  
  if (collegeName) {
    subLine += ` | ${closingPhrase}`;
  } else {
    subLine += ` | ${closingPhrase}`;
  }
  
  return subLine;
}

/**
 * Builds attractive exam heading with main line and marketing subline
 */
export function buildExamHeading(options: ExamHeadingOptions): ExamHeading {
  const {
    examTitle,
    collegeName,
    subject,
    level,
    questionCount,
    startYear,
    endYear
  } = options;
  
  // Determine academic year
  let academicStartYear = startYear;
  let academicEndYear = endYear;
  
  if (!academicStartYear || !academicEndYear) {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth(); // 0-based
    
    // Academic year typically starts in August/September (month 7/8)
    if (currentMonth >= 7) {
      // We're in the fall semester of the academic year
      academicStartYear = currentYear;
      academicEndYear = currentYear + 1;
    } else {
      // We're in the spring semester of the academic year
      academicStartYear = currentYear - 1;
      academicEndYear = currentYear;
    }
  }
  
  // Build main line - always uppercase with academic year
  const mainLine = `${examTitle.toUpperCase()} (${academicStartYear}/${academicEndYear})`;
  
  // Build attractive subline for marketing
  const subLine = buildMarketingSubline({
    subject,
    level,
    questionCount,
    collegeName
  });
  
  return {
    mainLine,
    subLine
  };
}

/**
 * Extract information from exam title for better subline generation
 */
export function parseExamTitle(title: string): {
  subject?: string;
  level?: string;
  collegeName?: string;
} {
  const titleUpper = title.toUpperCase();
  
  // Common subjects to detect
  const subjects = [
    'MICROBIOLOGY', 'BIOLOGY', 'CHEMISTRY', 'PHYSICS', 'ANATOMY', 'PHYSIOLOGY',
    'NURSING', 'PSYCHOLOGY', 'SOCIOLOGY', 'MATHEMATICS', 'CALCULUS', 'STATISTICS',
    'HISTORY', 'ENGLISH', 'LITERATURE', 'PHILOSOPHY', 'ECONOMICS', 'ACCOUNTING',
    'BUSINESS', 'MARKETING', 'COMPUTER SCIENCE', 'ENGINEERING'
  ];
  
  // Common levels to detect
  const levels = [
    'UNDERGRADUATE', 'GRADUATE', 'NURSING', 'PRE-MED', 'MEDICAL',
    'BACHELOR', 'MASTER', 'DOCTORAL', 'FRESHMAN', 'SOPHOMORE', 'JUNIOR', 'SENIOR'
  ];
  
  // Look for subjects
  const detectedSubject = subjects.find(subject => titleUpper.includes(subject));
  
  // Look for levels
  const detectedLevel = levels.find(level => titleUpper.includes(level));
  
  // Extract college name patterns (look for common college abbreviations or keywords)
  let collegeName: string | undefined;
  const collegePatterns = [
    /([A-Z]{2,4})\s+(?:UNIVERSITY|COLLEGE|INSTITUTE)/,
    /(GEORGIA\s+COLLEGE\s*(?:&|AND)?\s*STATE\s+UNIVERSITY)/,
    /(UNIVERSITY\s+OF\s+[A-Z\s]+)/,
    /([A-Z\s]+\s+UNIVERSITY)/,
    /([A-Z\s]+\s+COLLEGE)/
  ];
  
  for (const pattern of collegePatterns) {
    const match = title.match(pattern);
    if (match) {
      collegeName = match[1].trim();
      break;
    }
  }
  
  return {
    subject: detectedSubject ? detectedSubject.charAt(0) + detectedSubject.slice(1).toLowerCase() : undefined,
    level: detectedLevel ? detectedLevel.charAt(0) + detectedLevel.slice(1).toLowerCase() : undefined,
    collegeName
  };
}