// Dictionary of common leet-speak and special character replacements to avoid filter bypasses
const LEET_MAP = {
  '4': 'a', '@': 'a',
  '3': 'e',
  '1': 'i', '!': 'i', '|': 'i',
  '0': 'o',
  '5': 's', '$': 's',
  '7': 't', '+': 't',
  '8': 'b',
  '9': 'g'
};

// Comprehensive blacklist of offensive, abusive, and toxic terminology
const BLACKLIST = [
  'abuse', 'abuser', 'abusive', 'asshole', 'bitch', 'bastard', 
  'crap', 'cunt', 'dick', 'fuck', 'fucker', 'fucking', 'motherfucker', 
  'idiot', 'moron', 'loser', 'trash', 'dumbass', 'nigger', 'faggot', 
  'retard', 'shit', 'shitty', 'bullshit', 'slut', 'whore', 
  'kill yourself', 'kys', 'hate you', 'die'
];

/**
 * Replaces leet-speak variations with standard alphabetical letters.
 */
function normalizeText(text) {
  let normalized = text.toLowerCase();
  
  for (const [key, value] of Object.entries(LEET_MAP)) {
    normalized = normalized.replaceAll(key, value);
  }
  
  return normalized;
}

/**
 * Analyzes string and moderates profane or toxic phrases.
 * Returns an evaluation object.
 */
export function moderateContent(text) {
  if (!text || typeof text !== 'string') {
    return { isAbusive: false, cleanedText: text, matchedWords: [] };
  }

  const normalized = normalizeText(text);
  const matchedWords = [];
  let cleanedText = text;

  // 1. Moderate multi-word phrases first
  for (const word of BLACKLIST) {
    if (word.includes(' ')) {
      if (normalized.includes(word)) {
        matchedWords.push(word);
        // Dynamic case-insensitive regex pattern
        const regex = new RegExp(word.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'gi');
        cleanedText = cleanedText.replace(regex, '*'.repeat(word.length));
      }
    }
  }

  // 2. Tokenize and moderate individual words
  const originalTokens = cleanedText.split(/(\s+)/); // Preserve spaces for rebuilding
  
  for (let i = 0; i < originalTokens.length; i++) {
    const token = originalTokens[i];
    if (/^\s+$/.test(token)) continue; // Skip white space
    
    // Extract exact letters, stripping leading/trailing punctuation
    const cleanToken = token.replace(/^[.,\/#!$%\^&\*;:{}=\-_`~()]+/g, '')
                            .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]+$/g, '');
    
    const normalizedToken = normalizeText(cleanToken);
    
    // Match exact word or common extensions (e.g. plural or continuous tense)
    const matchesBlacklist = BLACKLIST.some(bad => {
      if (normalizedToken === bad) return true;
      if (bad.length > 3 && (normalizedToken === bad + 's' || normalizedToken === bad + 'ing' || normalizedToken === bad + 'ed')) {
        return true;
      }
      return false;
    });

    if (matchesBlacklist) {
      matchedWords.push(cleanToken);
      originalTokens[i] = token.replace(cleanToken, '*'.repeat(cleanToken.length));
    }
  }

  cleanedText = originalTokens.join('');

  // 3. Prevent spacing/punctuation bypass attempts (e.g., f.u.c.k or f-u-c-k)
  const compressed = normalized.replace(/[^a-z]/g, '');
  for (const bad of BLACKLIST) {
    if (bad.length >= 4 && !bad.includes(' ')) {
      if (compressed.includes(bad) && !matchedWords.some(w => normalizeText(w).includes(bad))) {
        matchedWords.push(bad);
        cleanedText = '*'.repeat(text.length); // Censor the whole string for severe bypass attempts
      }
    }
  }

  return {
    isAbusive: matchedWords.length > 0,
    cleanedText,
    matchedWords: [...new Set(matchedWords)]
  };
}
