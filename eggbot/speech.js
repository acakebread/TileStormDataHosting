// Copyright 2026 massivehadron.com ltd.

// Phrase decisions shared with the game's EggbotSpeech. The playground has no console to wait at.

const GREETING = /\b(?:hello|hallo|hi|hey)\b(?:\s+[a-z0-9']+){0,3}\s+(?:egg\s*(?:bot|bott|bought|but|butt|boat|box)|egbot|egbert)\b/i;
const QUESTION_WORDS = new Set([
  'what', 'whats', 'why', 'how', 'when', 'where', 'who', 'whom', 'whose', 'which',
  'can', 'cant', 'cannot', 'could', 'couldnt', 'would', 'wouldnt', 'will', 'wont',
  'shall', 'should', 'shouldnt', 'may', 'might', 'must',
  'is', 'isnt', 'are', 'arent', 'am', 'do', 'dont', 'does', 'doesnt', 'did', 'didnt',
  'have', 'havent', 'has', 'hasnt', 'had', 'hadnt', 'was', 'wasnt', 'were', 'werent'
]);
const UNRECOGNISED = ["I don't understand", 'sorry', "I can't hear you"];
const BELOW_TWENTY = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty'];

export function normalize(text) {
  let result = '';
  let pendingSpace = false;
  for (const character of text ?? '') {
    let current = character.toLowerCase();
    if (current === '’' || current === '`' || current === '´') current = "'";
    if (/[\p{L}\p{N}']/u.test(current)) {
      if (pendingSpace && result) result += ' ';
      pendingSpace = false;
      result += current;
    } else pendingSpace = true;
  }
  return result.trim();
}

function numberWords(value) {
  if (value < BELOW_TWENTY.length) return BELOW_TWENTY[value];
  return TENS[Math.floor(value / 10)] + (value % 10 === 0 ? '' : ` ${BELOW_TWENTY[value % 10]}`);
}

export function currentTimeReply(now = new Date()) {
  let hour = now.getHours() % 12;
  if (hour === 0) hour = 12;
  const spokenHour = numberWords(hour);
  if (now.getMinutes() === 0) return `it's ${spokenHour} o'clock`;
  const minute = now.getMinutes();
  return `it's ${spokenHour}${minute < 10 ? ' oh ' : ' '}${numberWords(minute)}`;
}

function addReply(replies, answer, phrases) {
  for (const phrase of phrases) replies.set(normalize(phrase), () => answer);
}

function createReplies() {
  const replies = new Map();
  addReply(replies, "I'm fine", ['how are you', 'how are you doing', 'are you okay', 'are you ok', 'are you all right']);
  addReply(replies, 'fixing the level', ['what are you doing', 'what are you working on']);
  addReply(replies, "I'm Eggbot", ['what is your name', "what's your name", 'who are you']);
  addReply(replies, "you're welcome", ['thank you', 'thanks']);
  addReply(replies, "it's okay", ['sorry']);
  addReply(replies, 'I better get on', ['goodbye', 'bye', 'see you later']);
  addReply(replies, "I'll try", [
    'can you help', 'can you help me', 'could you help me', 'will you help me', 'can you give me a hand',
    'can you do this', 'can you solve this', 'can you solve the puzzle', 'do you know how to do this'
  ]);
  addReply(replies, "it's hard", ['is it hard', 'is this hard']);
  addReply(replies, 'I am doing my best', ['are you doing your best', 'why are you taking so long', 'are you stuck']);
  addReply(replies, 'yes', ['are you still here', 'are you a robot', 'can you hear me', 'are you listening']);
  addReply(replies, 'I better get on', ['are you busy', 'should I leave you alone', "why aren't you working"]);
  addReply(replies, "I don't understand", ['do you understand', 'do you understand me']);
  addReply(replies, 'the foreman', ['who is your boss']);
  addReply(replies, 'my boss', ['who is the foreman']);
  addReply(replies, 'a little help', ['what do you need']);
  addReply(replies, 'for you to solve the puzzle', ['what are you waiting for']);
  addReply(replies, 'solve the puzzle', ['what should I do']);
  addReply(replies, 'not yet', ['have you finished', 'are you finished']);
  addReply(replies, "I don't know", ['how old are you', 'how long will it take', 'when will you be finished', 'where is the foreman', 'why']);
  for (const phrase of ["what's the time", 'whats the time', 'what is the time', 'what time is it'])
    replies.set(normalize(phrase), currentTimeReply);
  return replies;
}

const replies = createReplies();

export function tryGetReply(text, now = new Date()) {
  let normalized = normalize(text);
  if (GREETING.test(normalized)) normalized = normalized.replace(GREETING, ' ').replace(/\s+/g, ' ').trim();
  const direct = replies.get(normalized);
  if (direct) return direct(now);
  const stripped = normalized.replaceAll("'", '');
  for (const [key, answer] of replies)
    if (key.replaceAll("'", '') === stripped) return answer(now);
  return null;
}

export function unrecognisedReply(random = Math.random) {
  return UNRECOGNISED[Math.min(UNRECOGNISED.length - 1, Math.floor(random() * UNRECOGNISED.length))];
}

function startsWithQuestion(spoken) {
  const word = spoken.split(' ')[0].replaceAll("'", '');
  return QUESTION_WORDS.has(word);
}

export function interpret(text, attentive) {
  const none = { greeting: false, question: false, addressed: false };
  if (!text || !text.trim()) return none;
  const asked = text.includes('?');
  const normalized = normalize(text);
  if (!normalized) return none;
  const greeting = GREETING.test(normalized);
  let spoken = normalized;
  if (greeting) spoken = normalized.replace(GREETING, ' ').replace(/\s+/g, ' ').trim();
  else if (!attentive) return none;
  return {
    greeting,
    question: spoken.length >= 2 && (asked || startsWithQuestion(spoken)),
    addressed: greeting || attentive
  };
}
