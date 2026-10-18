/* Windows-friendly local word scoring + optional Gemini audio feedback. */
(function () {
  "use strict";

  const NUMBER_WORDS = {
    "0": "zero", "1": "one", "2": "two", "3": "three", "4": "four",
    "5": "five", "6": "six", "7": "seven", "8": "eight", "9": "nine",
    "10": "ten", "11": "eleven", "12": "twelve", "13": "thirteen",
    "14": "fourteen", "15": "fifteen", "16": "sixteen", "17": "seventeen",
    "18": "eighteen", "19": "nineteen", "20": "twenty", "30": "thirty",
    "40": "forty", "50": "fifty", "60": "sixty", "70": "seventy",
    "80": "eighty", "90": "ninety", "100": "hundred"
  };

  const CONTRACTIONS = {
    "i'm": "iam", "i've": "ihave", "i'll": "iwill", "i'd": "iwould",
    "it's": "itis", "that's": "thatis", "there's": "thereis",
    "they're": "theyare", "you're": "youare", "we're": "weare",
    "don't": "donot", "can't": "cannot", "won't": "willnot",
    "isn't": "isnot", "aren't": "arenot", "wasn't": "wasnot",
    "weren't": "werenot", "doesn't": "doesnot", "didn't": "didnot",
    "let's": "lets", "couldn't": "couldnot", "wouldn't": "wouldnot",
    "shouldn't": "shouldnot", "hasn't": "hasnot", "haven't": "havenot"
  };

  const STOPWORDS = new Set([
    "a", "an", "the", "and", "or", "but", "because", "is", "are", "am",
    "was", "were", "be", "my", "me", "i", "you", "we", "they", "he", "she",
    "it", "to", "of", "in", "on", "at", "so", "this", "that", "there"
  ]);

  const PAIRS = {
    "i am": "iam", "i have": "ihave", "i will": "iwill",
    "it is": "itis", "that is": "thatis", "there is": "thereis",
    "they are": "theyare", "you are": "youare", "we are": "weare",
    "do not": "donot", "can not": "cannot", "cannot": "cannot",
    "will not": "willnot", "is not": "isnot", "are not": "arenot",
    "was not": "wasnot", "were not": "werenot", "does not": "doesnot",
    "did not": "didnot", "could not": "couldnot", "would not": "wouldnot",
    "should not": "shouldnot", "has not": "hasnot", "have not": "havenot"
  };

  function cleanToken(token) {
    return String(token || "")
      .toLowerCase()
      .replace(/[\u2018\u2019\u02bc`]/g, "'")
      .replace(/^[^a-z0-9']+|[^a-z0-9']+$/g, "");
  }

  // Turn text into "sound tokens". A contraction stays one token, and the
  // expanded form ("I am") is folded to the same token, so a child is not
  // marked wrong for how the browser chose to spell what it heard.
  function tokenGroups(text) {
    const raw = String(text || "")
      .replace(/[\u2018\u2019\u02bc`]/g, "'")
      .replace(/[^a-zA-Z0-9'\s-]/g, " ")
      .replace(/-/g, " ")
      .split(/\s+/)
      .filter(Boolean);
    const parts = raw
      .map((display) => ({ display, clean: cleanToken(display) }))
      .filter((part) => part.clean);
    const groups = [];
    for (let i = 0; i < parts.length; i += 1) {
      let word = parts[i].clean;
      if (NUMBER_WORDS[word]) word = NUMBER_WORDS[word];
      if (CONTRACTIONS[word]) word = CONTRACTIONS[word];
      let display = parts[i].display;
      let labels = [display.replace(/^[^a-zA-Z0-9']+|[^a-zA-Z0-9']+$/g, "")];
      if (i + 1 < parts.length) {
        const next = parts[i + 1].clean;
        const pair = PAIRS[`${parts[i].clean} ${next}`];
        if (pair) {
          word = pair;
          display = `${parts[i].display} ${parts[i + 1].display}`;
          labels = [
            parts[i].display.replace(/^[^a-zA-Z0-9']+|[^a-zA-Z0-9']+$/g, ""),
            parts[i + 1].display.replace(/^[^a-zA-Z0-9']+|[^a-zA-Z0-9']+$/g, "")
          ];
          i += 1;
        }
      }
      groups.push({
        key: word,
        display: display.replace(/^[^a-zA-Z0-9']+|[^a-zA-Z0-9']+$/g, ""),
        labels
      });
    }
    return groups;
  }

  function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    let prev = new Array(b.length + 1);
    let cur = new Array(b.length + 1);
    for (let j = 0; j <= b.length; j += 1) prev[j] = j;
    for (let i = 1; i <= a.length; i += 1) {
      cur[0] = i;
      for (let j = 1; j <= b.length; j += 1) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      }
      const swap = prev; prev = cur; cur = swap;
    }
    return prev[b.length];
  }

  function similarity(a, b) {
    if (a === b) return 2;
    const len = Math.max(a.length, b.length);
    if (len < 4) return 0;
    const limit = len >= 8 ? 2 : 1;
    return levenshtein(a, b) <= limit ? 1 : 0;
  }

  function align(referenceGroups, heardGroups) {
    const a = referenceGroups.map((g) => g.key);
    const b = heardGroups.map((g) => g.key);
    const dp = [];
    for (let i = 0; i <= a.length; i += 1) dp.push(new Array(b.length + 1).fill(0));
    for (let i = a.length - 1; i >= 0; i -= 1) {
      for (let j = b.length - 1; j >= 0; j -= 1) {
        const sim = similarity(a[i], b[j]);
        dp[i][j] = Math.max(
          sim ? sim + dp[i + 1][j + 1] : 0,
          dp[i + 1][j],
          dp[i][j + 1]
        );
      }
    }
    const refFlags = a.map(() => "missed");
    let i = 0;
    let j = 0;
    while (i < a.length && j < b.length) {
      const sim = similarity(a[i], b[j]);
      if (sim && dp[i][j] === sim + dp[i + 1][j + 1]) {
        refFlags[i] = sim === 2 ? "great" : "almost";
        i += 1;
        j += 1;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        i += 1;
      } else {
        j += 1;
      }
    }
    return refFlags;
  }

  function localComments(accuracy, stars, focus, missed, almost, pace) {
    const names = focus.slice(0, 2);
    const phrase = names.length ? names.join(" 和 ") : "每个词";
    const missedName = missed && missed.length ? missed[0] : "";
    const almostName = almost && almost.length ? almost[0] : "";
    const allWordsGood = !missedName && !almostName;
    if (stars === 5) {
      return {
        zh: "太棒啦，这句话又完整又有节奏！你的声音像小星星一样亮。",
        en: "Wonderful! You said the whole sentence with a lovely rhythm. Five big stars!"
      };
    }
    if (stars >= 3 && allWordsGood) {
      if (pace === "fast") {
        return {
          zh: "每个词都说对啦！慢一点，把句子说完整，就满星啦。",
          en: "Every word was right! Slow down a little and the whole sentence will shine."
        };
      }
      if (pace === "slow") {
        return {
          zh: "每个词都说对啦！试着把句子连起来，说得更顺一点。",
          en: "Every word was right! Try linking the words with a smoother rhythm."
        };
      }
      return {
        zh: "说得真棒！再把节奏放稳一点，就满星啦。",
        en: "Great job! Keep a steady rhythm and the next try can sparkle."
      };
    }
    if (stars === 4) {
      return missedName
        ? {
            zh: `说得真棒！再听一听 ${missedName}，把它补上就满星啦。`,
            en: `Great job! Listen once more for ${missedName} and the next try can sparkle.`
          }
        : {
            zh: `说得真棒！${almostName || phrase}再清楚一点点，就满星啦。`,
            en: `Great job! Say ${almostName || phrase} just a little more clearly and it will sparkle.`
          };
    }
    const manyMissed = missed && missed.length >= 3;
    if (stars === 3) {
      return manyMissed
        ? {
            zh: "再听一遍完整句，跟着黄老师慢慢说，把后半句也带上。",
            en: "Listen to the whole sentence once more, then slowly say the ending too."
          }
        : {
            zh: missedName
              ? `不错的尝试！我们慢一点，把 ${missedName} 补上，再说完整句。`
              : `不错的尝试！我们先慢一点，把 ${almostName || phrase} 说清楚。`,
            en: `Good try! Slow down, add ${missedName || almostName || phrase}, and say the whole sentence.`
          };
    }
    if (stars === 2) {
      return manyMissed
        ? {
            zh: "没关系，我们再来一次。先听完整句，再跟着黄老师一句一句说。",
            en: "That's okay. Listen to the whole sentence, then follow your teacher step by step."
          }
        : {
            zh: `没关系，我们再来一次。先听黄老师，再大声跟着说 ${missedName || phrase}。`,
            en: `That's okay. Listen once more, then try ${missedName || phrase} in a big voice.`
          };
    }
    return {
      zh: "麦克风有点没听清。靠近一点，大声说出来，你一定可以！",
      en: "The microphone missed a little of your voice. Come closer and try again!"
    };
  }

  function starsFor(overall) {
    if (overall >= 95) return 5;
    if (overall >= 80) return 4;
    if (overall >= 60) return 3;
    if (overall >= 40) return 2;
    return 1;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function localScore(options) {
    const reference = String(options.reference || "");
    const transcript = String(options.transcript || "").trim();
    const refGroups = tokenGroups(reference);
    if (!refGroups.length) throw new Error("reference sentence is empty");
    if (!transcript) {
      return {
        provider: "local",
        available: false,
        overall: null,
        stars: 0,
        words: refGroups.map((g) => ({ word: g.display, status: "missed" })),
        transcript: "",
        pronunciation: null,
        fluency: null,
        completeness: 0,
        focus: [],
        commentZh: "我没有听清你的声音。再试一次，靠近麦克风大声说，好吗？",
        commentEn: "I couldn't hear you clearly. Come closer to the microphone and try again!",
        metrics: []
      };
    }
    const heardGroups = tokenGroups(transcript);
    const flags = align(refGroups, heardGroups);
    const exact = flags.filter((f) => f === "great").length;
    const near = flags.filter((f) => f === "almost").length;
    const completeness = clamp(Math.round(((exact + near * 0.7) / refGroups.length) * 100), 0, 100);
    const wordAccuracy = clamp(Math.round(((exact + near * 0.65) / refGroups.length) * 100), 0, 100);

    let fluency = 82;
    let pace = "steady";
    const speechSeconds = Number(options.speechSeconds) || Number(options.durationSeconds) || 0;
    const modelSeconds = Number(options.modelSeconds) || 4.5;
    if (speechSeconds > 0.5) {
      const expected = Math.max(modelSeconds * 0.85, refGroups.length / 2.5);
      const ratio = speechSeconds / expected;
      if (ratio < 0.7) fluency = 100 - (0.7 - ratio) * 105;
      else if (ratio > 1.85) fluency = 100 - (ratio - 1.85) * 42;
      else fluency = 100;
      fluency = clamp(Math.round(fluency), 55, 100);
      if (ratio < 0.72) pace = "fast";
      else if (ratio > 1.75) pace = "slow";
    }

    const overall = clamp(Math.round(wordAccuracy * 0.7 + completeness * 0.1 + fluency * 0.2), 0, 100);
    let stars = starsFor(overall);
    if (stars === 5 && flags.includes("missed")) stars = 4;
    const weakGroups = refGroups.filter((g, idx) => flags[idx] !== "great");
    const contentWeak = weakGroups.filter((g) => !STOPWORDS.has(g.key) && g.key.length > 1);
    const focus = (contentWeak.length ? contentWeak : weakGroups).map((g) => g.display).slice(0, 3);
    const missedWords = refGroups.filter((g, idx) => flags[idx] === "missed").map((g) => g.display);
    const almostWords = refGroups.filter((g, idx) => flags[idx] === "almost").map((g) => g.display);
    const comments = localComments(wordAccuracy, stars, focus.length ? focus : ["每个词"], missedWords, almostWords, pace);
    const words = refGroups.flatMap((g, idx) => (g.labels || [g.display]).map((word) => ({
      word,
      status: flags[idx],
      tip: flags[idx] === "missed" ? "再听一听这个单词" : flags[idx] === "almost" ? "再清楚一点" : ""
    })));

    return {
      provider: "local",
      available: true,
      overall,
      stars,
      words,
      transcript,
      pronunciation: wordAccuracy,
      fluency,
      completeness,
      focus,
      commentZh: comments.zh,
      commentEn: comments.en,
      metrics: [
        { key: "pronunciation", label: "听辨准确度", value: wordAccuracy, hint: "与原句单词的匹配程度" },
        { key: "fluency", label: "节奏", value: fluency, hint: "说话速度和停顿" },
        { key: "completeness", label: "完整度", value: completeness, hint: "有没有把话说完" }
      ]
    };
  }

  function normalizeAiWords(reference, aiWords, transcript) {
    const refGroups = tokenGroups(reference);
    const local = transcript ? align(refGroups, tokenGroups(transcript)) : refGroups.map(() => "missed");
    const supplied = Array.isArray(aiWords) ? aiWords : [];
    const byKey = new Map();
    supplied.forEach((entry) => {
      if (!entry || !entry.word) return;
      const groups = tokenGroups(entry.word);
      groups.forEach((g) => {
        const status = ["great", "almost", "missed"].includes(entry.status) ? entry.status : "almost";
        byKey.set(g.key, { status, tip: entry.tip || "" });
      });
    });
    return refGroups.flatMap((g, idx) => {
      const hit = byKey.get(g.key);
      const status = hit ? hit.status : local[idx];
      return (g.labels || [g.display]).map((word) => ({
        word,
        status,
        tip: hit ? hit.tip : status === "missed" ? "再听一听这个单词" : ""
      }));
    });
  }

  function normalizeAiResult(raw, options) {
    const refGroups = tokenGroups(options.reference);
    const safe = raw && typeof raw === "object" ? raw : {};
    const overall = clamp(Math.round(Number(safe.overall) || 0), 0, 100);
    const words = normalizeAiWords(options.reference, safe.words, safe.transcript || options.transcript || "");
    let stars = starsFor(overall);
    if (stars === 5 && words.some((word) => word.status === "missed")) stars = 4;
    const focus = Array.isArray(safe.focus) && safe.focus.length
      ? safe.focus.map(String).slice(0, 3)
      : words.filter((w) => w.status !== "great").map((w) => w.word).slice(0, 3);
    const fallback = localScore({
      reference: options.reference,
      transcript: options.transcript || "",
      speechSeconds: options.speechSeconds,
      modelSeconds: options.modelSeconds
    });
    return {
      provider: "gemini",
      available: true,
      overall,
      stars,
      words,
      transcript: String(safe.transcript || options.transcript || "").trim(),
      pronunciation: clamp(Math.round(Number(safe.pronunciation) || overall), 0, 100),
      fluency: clamp(Math.round(Number(safe.fluency) || overall), 0, 100),
      completeness: clamp(Math.round(Number(safe.completeness) || overall), 0, 100),
      focus: focus.length ? focus : refGroups.slice(0, 2).map((g) => g.display),
      commentZh: String(safe.comment_zh || fallback.commentZh).trim(),
      commentEn: String(safe.comment_en || fallback.commentEn).trim(),
      metrics: [
        { key: "pronunciation", label: "发音", value: clamp(Math.round(Number(safe.pronunciation) || overall), 0, 100), hint: "单词说清楚的程度" },
        { key: "fluency", label: "流利度", value: clamp(Math.round(Number(safe.fluency) || overall), 0, 100), hint: "节奏和自然停顿" },
        { key: "completeness", label: "完整度", value: clamp(Math.round(Number(safe.completeness) || overall), 0, 100), hint: "有没有把整句说完" }
      ]
    };
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || "");
        resolve(result.slice(result.indexOf(",") + 1));
      };
      reader.onerror = () => reject(reader.error || new Error("could not read audio"));
      reader.readAsDataURL(blob);
    });
  }

  const RESPONSE_SCHEMA = {
    type: "OBJECT",
    properties: {
      overall: { type: "INTEGER" },
      stars: { type: "INTEGER" },
      pronunciation: { type: "INTEGER" },
      fluency: { type: "INTEGER" },
      completeness: { type: "INTEGER" },
      transcript: { type: "STRING" },
      words: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            word: { type: "STRING" },
            status: { type: "STRING", enum: ["great", "almost", "missed"] },
            tip: { type: "STRING" }
          },
          required: ["word", "status"]
        }
      },
      comment_zh: { type: "STRING" },
      comment_en: { type: "STRING" },
      focus: { type: "ARRAY", items: { type: "STRING" } }
    },
    required: ["overall", "pronunciation", "fluency", "completeness", "transcript", "words", "comment_zh", "comment_en", "focus"]
  };

  function geminiPrompt(options) {
    return [
      "You are Teacher Huang (黄老师), a warm and playful kindergarten English speaking coach.",
      "A five-year-old child named Winnie is practising one sentence for a friendly kindergarten interview.",
      `Reference sentence: "${options.reference}"`,
      options.transcript ? `A browser speech recognizer heard: "${options.transcript}" (this may be inaccurate).` : "",
      "",
      "Listen to the recording carefully, then score this one repetition.",
      "Be encouraging and honest. Do not penalise a young child's accent, lisp, or normal developmental pronunciation. Reward understandable, complete, rhythmical speech.",
      "If the recording is silent or mostly unintelligible, give a low completeness score and gently ask the child to try again.",
      "Scores are integers from 0 to 100. Stars follow: overall <40 → 1, <60 → 2, <80 → 3, <95 → 4, otherwise 5. Never give 5 stars if a reference word is marked missed.",
      "The words array must list every reference sentence word in order, using the reference spelling. Status is great (clear and correct), almost (recognisable but unclear or approximate), or missed (not heard or wrong). Add a very short Chinese tip only for almost/missed words.",
      "comment_zh: 1–2 short, concrete, encouraging sentences in simplified Chinese for a five-year-old and their parent. Say one thing done well and one tiny next step. Never use the word 'bad'.",
      "comment_en: one very short English cheer of at most 12 words.",
      "focus: up to three reference words the child should practise next.",
      "transcript: what you actually heard, in plain English.",
      "Return only JSON that matches the schema."
    ].filter(Boolean).join("\n");
  }

  function friendlyAiError(status, message) {
    if (status === 400) return "Gemini 没有接受这个请求。请检查 API Key 和模型名称是否正确。";
    if (status === 403) return "这个 API Key 没有使用 Gemini 的权限，或免费额度尚未开通。";
    if (status === 404) return "找不到这个 Gemini 模型。请在设置里换一个模型试试。";
    if (status === 429) return "Gemini 的免费额度暂时用完了，休息一下再试，或先用快速评分。";
    if (status >= 500) return "Gemini 服务暂时有点忙，稍后再试也可以先用快速评分。";
    if (/fetch|network|load failed/i.test(message || "")) {
      return "无法连接 Gemini。请检查网络，或在 Chrome/Edge 中打开本页。";
    }
    return "黄老师现在有点忙，先用快速评分吧。";
  }

  async function callGemini(options, body) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(options.model)}:generateContent`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs || 45000);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": options.apiKey
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      let data = null;
      try { data = await response.json(); } catch (error) { data = null; }
      if (!response.ok) {
        const message = data && data.error && data.error.message ? data.error.message : `HTTP ${response.status}`;
        const error = new Error(friendlyAiError(response.status, message));
        error.status = response.status;
        error.detail = message;
        throw error;
      }
      return data;
    } catch (error) {
      if (error.name === "AbortError") throw new Error("评分等得有点久，先用快速评分吧。");
      if (!error.status) throw new Error(friendlyAiError(0, error.message || String(error)));
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async function geminiScore(options) {
    if (!options.apiKey) throw new Error("还没有填写 Gemini API Key。");
    const audioBlob = options.audioBlob;
    if (!audioBlob || !audioBlob.size) throw new Error("没有可发送的录音。");
    if (audioBlob.size > 18 * 1024 * 1024) throw new Error("这段录音太长了，请再录一次短一点的。");
    const base64 = await blobToBase64(audioBlob);
    const mimeType = options.mimeType || audioBlob.type || "audio/wav";
    const body = {
      contents: [{
        parts: [
          { text: geminiPrompt(options) },
          { inline_data: { mime_type: mimeType, data: base64 } }
        ]
      }],
      generationConfig: {
        temperature: 0.2,
        response_mime_type: "application/json",
        response_schema: RESPONSE_SCHEMA
      }
    };
    const data = await callGemini(options, body);
    const candidate = data && data.candidates && data.candidates[0];
    const text = candidate && candidate.content && candidate.content.parts
      ? candidate.content.parts.map((part) => part.text || "").join("")
      : "";
    if (!text.trim()) {
      const reason = candidate && candidate.finishReason ? `（${candidate.finishReason}）` : "";
      throw new Error(`黄老师没有返回评分结果${reason}，先用快速评分吧。`);
    }
    let parsed;
    try {
      const jsonText = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
      parsed = JSON.parse(jsonText);
    } catch (error) {
      throw new Error("评分结果没有看懂，先用快速评分吧。");
    }
    return normalizeAiResult(parsed, options);
  }

  async function testGemini(options) {
    const body = {
      contents: [{ parts: [{ text: "Reply with the single word: OK" }] }],
      generationConfig: { maxOutputTokens: 8, temperature: 0 }
    };
    const data = await callGemini({ ...options, timeoutMs: 20000 }, body);
    const candidate = data && data.candidates && data.candidates[0];
    const text = candidate && candidate.content && candidate.content.parts
      ? candidate.content.parts.map((part) => part.text || "").join("")
      : "";
    if (!text.trim()) throw new Error("连接成功，但模型没有返回内容。");
    return text.trim();
  }

  window.WinnieScoring = {
    localScore,
    geminiScore,
    testGemini,
    normalizeAiResult,
    tokenGroups,
    align,
    starsFor,
    _levenshtein: levenshtein
  };
})();
