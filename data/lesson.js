/* The four interview sentences and the friendly prompts around them. */
window.WINNIE_LESSON = {
  id: "winnie-about-me",
  title: "All About Winnie",
  titleZh: "认识 Winnie",
  child: "Winnie",
  age: 5,
  welcomeAudio: "assets/audio/welcome.wav",
  challenge: {
    en: "Hi, my name is Winnie and I'm five years old! My favorite foods are ice cream and cake because they are super sweet. My favorite colors are pink and purple because they make me feel warm and happy. There are five people and a dog in my family, and I love my family so much!",
    zh: "你好，我叫 Winnie，今年五岁！我最喜欢的食物是冰淇淋和蛋糕，因为它们超级甜。我最喜欢的颜色是粉色和紫色，因为它们让我感到温暖和快乐。我家有五个人和一只小狗，我非常爱我的家人！",
    scene: "assets/img/scene-lesson.svg",
    sceneAlt: "An open storybook with stars and letters",
    audio: {
      teacher: "assets/audio/paragraph-teacher.wav",
      friend: "assets/audio/paragraph-friend.wav",
      slow: "assets/audio/paragraph-slow.wav"
    },
    durations: { teacher: 19.32, friend: 23.35, slow: 23.71 },
    maxSeconds: 90,
    tip: "把四句话连起来完整说一遍，慢慢来，不用着急。"
  },
  demoDurations: [5.33, 5.69, 6.34, 6.29, 23.35],
  sentences: [
    {
      id: "name",
      en: "Hi, my name is Winnie and I'm five years old!",
      zh: "你好，我叫 Winnie，今年五岁！",
      speech: "Hi! My name is Winnie, and I'm five years old!",
      scene: "assets/img/scene-name.svg",
      sceneAlt: "Five birthday candles, a number five balloon and a Hello bubble",
      durations: { teacher: 4.34, friend: 5.40, slow: 5.18 },
      tip: "先笑着说 Hi，再说出名字和年龄。",
      maxSeconds: 20
    },
    {
      id: "food",
      en: "My favorite foods are ice cream and cake because they are super sweet.",
      zh: "我最喜欢的食物是冰淇淋和蛋糕，因为它们超级甜。",
      speech: "My favorite foods are ice cream and cake, because they are super sweet!",
      scene: "assets/img/scene-food.svg",
      sceneAlt: "A pink ice cream cone and a slice of strawberry cake",
      durations: { teacher: 4.87, friend: 5.78, slow: 5.90 },
      tip: "favorite 要重读，super sweet 可以带着开心的语气说。",
      maxSeconds: 20
    },
    {
      id: "colors",
      en: "My favorite colors are pink and purple because they make me feel warm and happy.",
      zh: "我最喜欢的颜色是粉色和紫色，因为它们让我感到温暖和快乐。",
      speech: "My favorite colors are pink and purple, because they make me feel warm and happy!",
      scene: "assets/img/scene-colors.svg",
      sceneAlt: "Pink and purple paint, hearts and a paintbrush",
      durations: { teacher: 5.74, friend: 6.41, slow: 6.86 },
      tip: "pink and purple 两个颜色词都要说清楚，because 前面可以停一小下。",
      maxSeconds: 22
    },
    {
      id: "family",
      en: "There are five people and a dog in my family, and I love my family so much!",
      zh: "我家有五个人和一只小狗，我非常爱我的家人！",
      speech: "There are five people and a dog in my family, and I love my family so much!",
      scene: "assets/img/scene-family.svg",
      sceneAlt: "A framed family photo with five people and a little dog",
      durations: { teacher: 5.59, friend: 6.31, slow: 5.93 },
      tip: "慢慢说，最后一句 so much 要说得有感情。",
      maxSeconds: 22
    }
  ],
  demoTranscripts: [
    "Hi, my name is Winnie and I'm five years old.",
    "My favorite foods are ice cream and cake because they are really sweet.",
    "My favorite colors are pink and purple because they make me feel warm and happy.",
    "There are five people and a dog in my family and I love my family so much.",
    "Hi, my name is Winnie and I'm five years old. My favorite foods are ice cream and cake because they are super sweet. My favorite colors are pink and purple because they make me feel warm and happy. There are five people and a dog in my family, and I love my family so much."
  ]
};
