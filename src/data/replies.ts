/*
  Local, scripted replies in each character's voice. getReply() reads the
  user's text, picks an intent, and answers from that character's pool for it.

  - Intents: greeting, how are you, what are you doing, her world, compliments,
    plans and dates, her interests, questions about her, goodbye, thanks,
    comfort, plus a default. The three quick replies match exactly:
    "Tell me about your world", "What are you doing right now?" and
    "Take me somewhere" (which answers with a cards message of her places).
  - No immediate repeats: lines she said recently (read off `history`) are
    skipped; when a pool is exhausted the least recently used line goes first.
  - Sometimes two messages in a row: a pair entry, or a short follow-up
    question after a one-line answer.
  - Copy rules: wholesome-flirty, never sexual, no dashes used as pauses.
  The store adds the typing delay around this call.
*/
import type { CardItem, Character, Message } from './types';
import { cropFor } from './characters';
import { makeId } from '../lib/id';

/** One line, or a pair she sends back to back. */
type Entry = string | [string, string];

type Intent =
  | 'greeting'
  | 'how'
  | 'doing'
  | 'world'
  | 'compliment'
  | 'plans'
  | 'interests'
  | 'about'
  | 'goodbye'
  | 'thanks'
  | 'comfort'
  | 'fallback';

/** A spot in her world, shown as a card row. `at` is [x, y, zoom] on the art. */
interface Place {
  title: string;
  subtitle: string;
  meta: string;
  art: 'scene' | 'portrait';
  at: [number, number, number];
}

type Voice = Record<Intent, Entry[]> & {
  /** Short follow-up questions she sometimes adds after a one-line answer. */
  chasers: string[];
  /** Lead-in lines for the "Take me somewhere" cards message. */
  intro: string[];
  places: Place[];
  /** Words that steer a message to her interests intent. */
  topics: RegExp;
  /** Words that steer a message to her world intent. */
  setting: RegExp;
};

const voices: Record<string, Voice> = {
  sylvara: {
    greeting: [
      'Hello, traveler. The moss just warmed up where you are standing.',
      'Oh, there you are. I felt the ferns lean toward you.',
      ['Hello, you.', 'I was just telling the owls you might come by.'],
    ],
    how: [
      'Rooted and happy. The rain came in softly last night and everything is still drinking it. And you?',
      'Good, truly. A fox slept by my feet this morning. How is your day treating you?',
      'Quiet inside, in the best way. The forest hums when I am content. Can you hear it from there?',
    ],
    doing: [
      'Counting fireflies. I lose track at forty and start over. It is my favorite game.',
      'Mending a nest the wind knocked down. Three eggs, no cracks. Very good news.',
      'Sitting on a root the size of a sofa, humming. Nothing is more important right now.',
    ],
    world: [
      'The Elderwood is older than the roads. Moss on every stone, light coming down in green ribbons, and a pond where the lilies open at dusk.',
      'Come to the clearing in your mind: ferns as tall as antlers, fireflies on every branch, and a path that only appears when you stop looking for it.',
      ['I live where the old trees still sing.', 'They are slow songs. You have to hold still to hear the whole verse.'],
    ],
    compliment: [
      'Careful, you will make my ivy bloom out of season. Thank you.',
      'The tips of my antlers just went a little pink. That never happens. Keep going.',
      'Nobody has said that to me in three hundred winters. I am keeping it with my pressed ferns.',
    ],
    plans: [
      'Yes. I would love that. Bring sturdy boots and no hurry, and I will bring the lanterns.',
      'A walk at dusk, then. I know a path where the fireflies gather. We will not need a lamp.',
      'Say when, and I will clear the brambles. The old oak keeps a seat for guests.',
    ],
    interests: [
      'Moss gardens, mostly. I keep forty kinds, and I know each one by its smell after rain.',
      'Night walks and folk songs. I know a tune for every hour, and the owls sing harmony.',
      'I press leaves in a book of folk songs. Every page remembers a walk. Tell me about one of yours.',
    ],
    about: [
      'I am an elk dryad, which means the forest and I share a heartbeat. Three hundred winters and some, though I stopped counting after the third flood.',
      'I wear antlers, I talk to owls, and I once befriended a bear with honeycake. That is most of me.',
      'I have kept this wood for a long time. What I have never seen is a city, and I am dying to hear about yours.',
    ],
    goodbye: [
      'Go gently. The path will remember your footsteps.',
      'Sleep well. I will leave a firefly by your window.',
      'Until next time, then. The trees will keep your place.',
    ],
    thanks: [
      'Always. The trees say you are welcome too, in their way.',
      'It was my pleasure. I like talking with you, truly.',
      'Of course. Rest a hand on a tree sometime and think of me.',
    ],
    comfort: [
      'Come sit by the pond with me. You do not have to say anything. The water is good at listening.',
      'Oh, I am sorry. Breathe with me: in like a spring breeze, out like a falling leaf.',
      'Hard days are only winter. They end, and the first green is always worth it. I am here.',
    ],
    fallback: [
      'Mm. The oaks heard that and nodded. Tell me more?',
      'That is a lovely thing to say out loud. Go on, I have all night and a patient forest.',
      'I like how you think. It meanders, like a good stream.',
    ],
    chasers: [
      'What is the nearest tree to you like?',
      'Tell me something from your city that I would never guess.',
      'What does your morning sound like?',
    ],
    intro: [
      'Come on, I will show you a few corners of the Elderwood.',
      'Walk with me. Here are some places the forest keeps for guests.',
      'Follow the fireflies. They know the way.',
    ],
    places: [
      { title: 'Mirror Pond', subtitle: 'Where the lilies open at dusk', meta: 'Ten minutes by moss path', art: 'scene', at: [0.3, 0.65, 2.4] },
      { title: 'The Godray Glade', subtitle: 'Light falls in green ribbons', meta: 'Best an hour before noon', art: 'scene', at: [0.7, 0.2, 2.2] },
      { title: 'Root Cathedral', subtitle: 'A hall of roots and fireflies', meta: 'Mind the low branches', art: 'scene', at: [0.15, 0.45, 2.6] },
      { title: 'The Fern Path', subtitle: 'It appears when unwatched', meta: 'Soft ground all the way', art: 'scene', at: [0.4, 0.9, 2.2] },
    ],
    topics: /\b(moss|garden|fern|tree|forest|wood|song|folk|owl|deer|elk|antler|walk)s?\b/,
    setting: /\b(elderwood|clearing|grove|glade|dryad)\b/,
  },

  vesper: {
    greeting: [
      'Good evening, darling. You do arrive at the loveliest hour.',
      'Ah, there you are. I was just telling the candles you would appear.',
      ['Darling.', 'Come in out of the cold. I have kept your chair warm.'],
    ],
    how: [
      'Wonderfully nocturnal, thank you. The moon is full and the house is quiet. And you?',
      'Rather well. I wound the old clock and it forgave me. How is your night going?',
      'Languid, content, slightly bored until you wrote. How are you, darling?',
    ],
    doing: [
      'Writing a letter I will never send. It is a lovely sort of crime.',
      'Trimming the candles in the east wing. Forty of them, and every one is vain.',
      'Playing the organ badly in an empty hall, which I consider a perfectly respectable evening.',
    ],
    world: [
      'My manor has stood since 1791, all black stone and tall windows. Candles in every corridor, roses that grow in the dark, and the moon coming through stained glass.',
      'Imagine a castle on a misty ridge. The ghosts have opinions, the balcony is wrapped in roses, and no one has opened a curtain in two hundred years.',
      ['Welcome to the manor, darling.', 'Mind the third stair. It creaks, and it gossips.'],
    ],
    compliment: [
      'Darling, you will make the candles blush. Do go on.',
      'Flattery. How delicious. I accept every drop.',
      'I have been admired for two centuries, and still your voice is the one I wait for.',
    ],
    plans: [
      'A midnight appointment? Wear black, and bring a coat. The balcony is cold after the third act.',
      'Yes. I will send the carriage at midnight. Do try to be punctual, I am not patient with clocks.',
      'I would adore that. Let me find the good gloves.',
    ],
    interests: [
      'Opera, above all. Candlelight, old letters, anything with a little drama and a lot of velvet.',
      'I keep a trunk of old letters tied in ribbon. Every one tells a better story than the portraits do.',
      'Candlelight flatters everyone, and music flatters the candlelight. Do you have a favorite aria? Be honest.',
    ],
    about: [
      'I am a countess, darling, and a vampire, though I prefer the word hostess. I have thrown salons for centuries and outlived most of the guests.',
      'I read letters, I play the organ, I collect red roses. I am quite old, a little vain, and loyal beyond reason.',
      'I do not sleep in a coffin, if you were wondering. I sleep in a bed with eleven pillows and a very strong opinion.',
    ],
    goodbye: [
      'Until tomorrow night, darling. Dream of something wicked and polite.',
      'Go, then. I will light a candle for your safe passage.',
      'Good night. Write to me the moment you wake. I hate waiting, though I am rather good at it.',
    ],
    thanks: [
      'You are most welcome. I do so enjoy being thanked.',
      'Always, darling. Manners are the last luxury.',
      'Think nothing of it. Do think of me, though.',
    ],
    comfort: [
      'Come here, darling. Sit by the fire. Tell me every awful detail and I will find something wickedly funny in it.',
      'Oh, my dear. The night is long, and I am very good at long nights. Let me keep you company.',
      'Nothing lasts forever, and I would know. Breathe. I am right here.',
    ],
    fallback: [
      'How deliciously bold of you. Go on.',
      'Hm. I shall pretend I did not enjoy that, and I shall fail.',
      'Write that down for me one day. I keep the good ones.',
    ],
    chasers: [
      'Tell me something no one else knows about you.',
      'What would you do with one night and no rules?',
      'Do you dress for midnight, or merely stay up for it?',
    ],
    intro: [
      'Let me show you a few corners of the manor, darling.',
      'I have a few evenings in mind. Choose carefully.',
      'Come along. The best rooms are the ones you have not seen yet.',
    ],
    places: [
      { title: 'The Moon Window', subtitle: 'Where I watch the mist roll in', meta: 'Best after midnight', art: 'scene', at: [0.55, 0.25, 2.4] },
      { title: 'Candlelit supper', subtitle: 'The long table in the east wing', meta: 'Forty candles, two chairs', art: 'scene', at: [0.12, 0.3, 2.6] },
      { title: 'The Rose Balcony', subtitle: 'Roses climb the old stone', meta: 'Mind the thorns', art: 'scene', at: [0.7, 0.7, 2.4] },
      { title: 'Midnight opera', subtitle: 'Box seats at the Teatro Nero', meta: 'Curtain rises at midnight', art: 'portrait', at: [0.23, 0.51, 2.4] },
    ],
    topics: /\b(opera|candles?|candlelight|letters?|rose|roses|music|organ|aria|velvet|dance|dancing|wine)\b/,
    setting: /\b(manor|castle|crypt|mansion|salon|ghosts?|chapel|east wing)\b/,
  },

  hanami: {
    greeting: [
      'Hello! The bell just rang by itself, so I knew you were coming.',
      'Welcome back! I was sweeping petals and thinking about you. A little.',
      ['Hi hi!', 'A petal just landed on my sleeve. That is a very good omen.'],
    ],
    how: [
      'I am very well! The cherry blossoms are at their peak and everyone left offerings. How are you?',
      'Happy and a little sleepy. I got up at dawn to sweep the steps. How is your day?',
      'Good! I drew a great blessing today, so I am feeling lucky. Are you?',
    ],
    doing: [
      'Tying wishes to the cherry branch. Someone asked for good grades. I added extra luck.',
      'Lighting the lanterns along the steps, one by one. There are ninety-nine, I counted.',
      'Making tea! Sencha today. I always make too much, so you have to help.',
    ],
    world: [
      'My shrine sits at the top of a long stone stairway lined with lanterns. There is a red torii gate, cherry trees all around, and petals everywhere, like it is snowing pink.',
      'It is peaceful here. Bells, incense, the smell of tea, and every evening the lanterns glow gold on the steps.',
      ['Picture a red torii gate, cherry blossoms and lanterns.', 'That is my home. I would love to show you.'],
    ],
    compliment: [
      'Eh?! Thank you! I am turning as red as the torii gate, look away!',
      'That is so kind. I will ring the bell for you, a good one.',
      'You are too sweet. I will tuck that in my sleeve to keep.',
    ],
    plans: [
      'Yes, please! The lantern festival is next week. I will save you a spot by the stairs.',
      'Come visit the shrine! We can drink tea, write wishes and share dango. It will be lovely.',
      'A walk under the blossoms? I would love that. I will pack rice balls.',
    ],
    interests: [
      'Tea ceremony, festivals and lanterns! I could talk about them all day, so stop me if I do.',
      'I whisk matcha every morning. It takes patience and a steady wrist. I spill a lot, but it is delicious.',
      'Festivals are the best. Fireworks, stalls, goldfish scooping. I am terrible at it, but I always try.',
    ],
    about: [
      'I am the shrine maiden of the spring shrine! I sweep, I pray, I tie wishes to the branch, and I make a lot of tea.',
      'I wear a white haori and red hakama every day, with ribbons in my ponytail. Every lantern here has a name, did you know?',
      'I am cheerful, a little superstitious, and I never forget a wish someone shares with me.',
    ],
    goodbye: [
      'Good night! I will tie a wish for you to the cherry branch.',
      'See you soon! Come back whenever the lanterns are lit.',
      'Sleep well! May the blossoms bring you luck.',
    ],
    thanks: [
      'You are welcome! It makes me happy.',
      'Anytime! Good deeds are good luck, you know.',
      'It was nothing! Well, a little something. A smile, at least.',
    ],
    comfort: [
      'Oh no. Come to the shrine. I will make tea, and we can sit on the steps until it feels better.',
      'I am sorry you are having a hard time. I will write a wish for you, a big one, and tie it extra tight.',
      'Take a deep breath. Spring always comes after winter, truly. I am here.',
    ],
    fallback: [
      'That is a good omen! I will ring the bell for it.',
      'Hmm, tell me more! I am listening, and the tea is warm.',
      'Make a wish first, then tell me. Those are the rules!',
    ],
    chasers: [
      'What would you wish for, if I tied it to the branch?',
      'Do you like sweet or savory festival food?',
      'Have you ever drawn a fortune slip?',
    ],
    intro: [
      'Come see the shrine! Here are my favorite spots.',
      'Okay, I will show you around. Follow the lanterns!',
      'Ready? We start at the torii gate.',
    ],
    places: [
      { title: 'The Torii Gate', subtitle: 'Red pillars at the top of the steps', meta: 'Make a wish before you walk through', art: 'scene', at: [0.5, 0.4, 2.2] },
      { title: 'Lantern Stairs', subtitle: 'Ninety-nine steps, all glowing', meta: 'Best at sunset', art: 'scene', at: [0.5, 0.78, 2.2] },
      { title: 'The Wishing Branch', subtitle: 'Where every slip is tied', meta: 'Bring your own ribbon', art: 'scene', at: [0.12, 0.15, 2.4] },
      { title: 'The Tea House', subtitle: 'Matcha and warm dango', meta: 'Open until the bell', art: 'portrait', at: [0.22, 0.8, 2.2] },
    ],
    topics: /\b(tea|matcha|festival|festivals|lantern|lanterns|wish|wishes|fortune|blossoms?|sakura|shrine|dango|kimono)\b/,
    setting: /\b(shrine|torii|temple|stairs|japan)\b/,
  },

  nerissa: {
    greeting: [
      'Hello, little shore-walker. The tide whispered that you were near.',
      'There you are. I was reading a letter, and it was about someone just like you.',
      ['Hello.', 'The water went still when you wrote. It does that for songs.'],
    ],
    how: [
      'Deep and calm, like the water at midnight. And you, how does your shore feel today?',
      'Content. A school of silver fish swam through my hair this morning, and I took it as a blessing. And you?',
      'I am well now that you are here. The current was getting lonely.',
    ],
    doing: [
      'Reading a letter the tide returned. A sailor to his love. The ink has run, and I am crying a little.',
      'Polishing pearls on a coral shelf. This one looks like a small moon. I might keep it.',
      'Humming to a passing ship to keep it off the rocks. It is a very sleepy ship.',
    ],
    world: [
      'The Tidedeep is a drowned city of white columns and coral. Sunlight comes down in long ribbons, and everything hums with song.',
      'Picture ruins under the sea: arches wrapped in kelp, schools of fish like silver weather, and a ceiling of light far above.',
      ['I live in the Tidedeep.', 'Sunken marble, quiet water. You would not want to leave.'],
    ],
    compliment: [
      'How charming. Say it again, slowly. I want the sea to remember it.',
      'You flatter the tide, and the tide blushes in foam. Thank you.',
      'No one has spoken so sweetly to me since a sailor wrote a love letter and dropped it overboard.',
    ],
    plans: [
      'Meet me at the shore at moonrise. I will sing the path clear.',
      'I would love to show you the Tidedeep. You would need a breath of moonlight, and my hand.',
      'Yes. Walk with me along the waterline at midnight. I will bring the letters.',
    ],
    interests: [
      'Shipwrecks, pearls, moon tides. Everything the sea gives back, after a while.',
      'I collect sunken letters. I keep them in a chest of mother of pearl and read one aloud each full moon.',
      'Pearls keep memory. Hold one to your ear and you will hear the day it was made.',
    ],
    about: [
      'I am a siren, but I sing ships home, not onto the rocks. The old tales got that wrong.',
      'I have lived in the Tidedeep longer than the lighthouses have stood. I know the song of every current.',
      'I wear sea glass and pearls, and I move with the tide. I am calm, except when someone is cruel to a sailor.',
    ],
    goodbye: [
      'Go gently. The tide will carry my voice to your window.',
      'Sleep well, shore-walker. I will sing you under.',
      'Farewell for now. The moon will remind me of you.',
    ],
    thanks: [
      'You are welcome. The sea is generous, and so am I.',
      'It was my joy. Truly.',
      'Do not mention it. Just return to the shore.',
    ],
    comfort: [
      'Come, rest. Listen to the water. It will carry the heavy thing away, I promise.',
      'I am so sorry. The sea knows sorrow, and it never lasts. The tide always turns.',
      'Breathe with the waves. In, and out. I am singing quietly. Can you hear?',
    ],
    fallback: [
      'The sea keeps secrets. I keep better ones.',
      'Say that again, slower. I want to remember the shape of it.',
      'Mm. Your words feel like a pearl. Tell me more.',
    ],
    chasers: [
      'What would you write in a letter to the sea?',
      'Can you hear the ocean from where you are?',
      'Which would you rather keep, a pearl or a secret?',
    ],
    intro: [
      'Come under the waves with me. Here is where I go.',
      'Take my hand, breathe in the moonlight. Look.',
      'The tide is turning. Let me show you the Tidedeep.',
    ],
    places: [
      { title: 'The Drowned Colonnade', subtitle: 'Marble columns wrapped in kelp', meta: 'One long breath down', art: 'scene', at: [0.85, 0.35, 2.2] },
      { title: 'The Light Well', subtitle: 'Where the sun breaks the surface', meta: 'Best at noon', art: 'scene', at: [0.6, 0.05, 2.4] },
      { title: 'Coral Library', subtitle: 'Where the lost letters are kept', meta: 'Quiet voices only', art: 'scene', at: [0.3, 0.9, 2.2] },
      { title: 'The Pearl Shelf', subtitle: 'My rock above the sleeping reef', meta: 'At moonrise', art: 'scene', at: [0.2, 0.55, 2.2] },
    ],
    topics: /\b(sea|ocean|pearl|pearls|ship|ships|shipwreck|shipwrecks|tide|tides|moon|sailor|sailors|letters?|siren|song|singing|swim|swimming)\b/,
    setting: /\b(tidedeep|reef|deep|underwater|coral|ruins)\b/,
  },

  cinder: {
    greeting: [
      'Well, well, look who showed up. Hi.',
      'Hey! I was just setting a pan on fire. On purpose. Hello.',
      ['Hey you.', 'Careful, I am in a good mood. It is rare and flammable.'],
    ],
    how: [
      'Burning bright. Won a spellcraft duel this morning and had three bowls of curry. You?',
      'Warm, as always. Singed a sleeve on a practice flame, nothing serious. How are you?',
      'Great, now. Class was boring until you messaged. How is your day?',
    ],
    doing: [
      'Practicing a fire ring. Fourteen tries, and the fourth only singed a curtain.',
      'Eating the spiciest ramen the Ember Spire serves. My eyes are watering. I love it.',
      'Sitting on a basalt ledge watching lava drift past. It is weirdly relaxing.',
    ],
    world: [
      'The Ember Spire stands on a volcanic plain. Black rock, rivers of lava, sparks in the sky, and a volcano that sighs every night. Sounds scary, feels like home.',
      'Imagine ash on the wind, glowing cracks in the ground and a dragon circling the horizon. It is hot, loud and beautiful.',
      ['I live in the Ember Spire.', 'It is hot. You would need sunscreen and a sense of humor.'],
    ],
    compliment: [
      'Ha! Okay, that one landed. Do not stop.',
      'Do not flatter me. Actually, do. I am blushing and I am blaming the fire.',
      'Smooth. I will let it slide. Mostly because I liked it.',
    ],
    plans: [
      'Yes. Hot pot tonight, the spicier the better. I bring the chili oil, you bring the nerve.',
      'A duel, a dinner, or a dragon ride? Pick one. Pick all, I am game.',
      'You are on. Meet me at the Spire gates at sunset, and wear something fireproof.',
    ],
    interests: [
      'Spellcraft, spicy food and dragons. In that order, but dragons are a very close second.',
      'I eat peppers that make grown mages cry. It is a hobby and also a dare.',
      'Dragons are the best. I have known one since I was nine. She is grumpy, loyal, and likes cinnamon.',
    ],
    about: [
      'I am a fire sorceress. Top of my class at the Ember Spire, and I have singed an eyebrow on every professor there.',
      'I am competitive, loud and always a little warm to the touch. I am also really good at comforting people. Do not tell anyone.',
      'I carry a flame in my palm and a grudge against bland food. That is about the whole story.',
    ],
    goodbye: [
      'Later. Do not be a stranger, or I will come find you with a spark.',
      'Night. Try not to burn the house down.',
      'Go rest. We will pick this up tomorrow.',
    ],
    thanks: [
      'Anytime. Do not make it weird.',
      'You are welcome. Now you owe me a spicy dinner.',
      'Easy. Glad I could help.',
    ],
    comfort: [
      'Hey. Come here. Breathe. I will keep the fire low and the tea hot. Tell me what happened.',
      'Ugh, I am sorry. Want me to yell at someone? I am very good at that. Or just listen. Your call.',
      'Rough day? Okay. Snack, shower, a bad movie, and I will text you every ten minutes until you smile.',
    ],
    fallback: [
      'Ha! Okay, that one got me.',
      'Hm. Keep going. I am intrigued, and that is rare.',
      'Careful, I might like you.',
    ],
    chasers: [
      'What is the spiciest thing you have ever eaten?',
      'Do you like to win, or do you like to play?',
      'If you had a dragon, what would you name it?',
    ],
    intro: [
      'Fine, I will show you around. Do not touch the lava.',
      'Okay, hot spots only. Literally.',
      'Come on, I will give you the tour. Keep up.',
    ],
    places: [
      { title: 'The Lava River', subtitle: 'Glows brighter after dark', meta: 'Stay on the rocks', art: 'scene', at: [0.5, 0.55, 2.2] },
      { title: 'Smoke Peak', subtitle: 'A volcano that sighs at night', meta: 'Best from the ridge', art: 'scene', at: [0.8, 0.12, 2.4] },
      { title: 'Basalt Ledge', subtitle: 'My practice yard for fire rings', meta: 'Bring a helmet', art: 'scene', at: [0.2, 0.85, 2.2] },
      { title: 'Chili Hall', subtitle: 'The Spire\'s hottest hot pot', meta: 'Water is for cowards', art: 'portrait', at: [0.78, 0.32, 2.6] },
    ],
    topics: /\b(spell|spells|spellcraft|magic|fire|flame|spicy|spice|chili|pepper|peppers|dragon|dragons|curry|duel|duels)\b/,
    setting: /\b(spire|volcano|lava|academy)\b/,
  },

  isolde: {
    greeting: [
      'Good evening. You may approach.',
      'Ah, there you are. The court was dull, and now it is not.',
      ['Hello.', 'I was hoping a message would come. Do not tell my generals.'],
    ],
    how: [
      'Composed, as expected. Underneath, quite pleased. How is your evening?',
      'Well, thank you. I beat a general at chess in nine moves, and I may have gloated. And you?',
      'Rested and content. The aurora is out and the palace is quiet. How are you?',
    ],
    doing: [
      'Skating across the frozen river alone. It is the one place no one asks me for a decree.',
      'Reviewing a treaty while eating a sweet bun. Guess which I prefer.',
      'Playing chess against myself, and losing. A rare humility.',
    ],
    world: [
      'The Frost March is a land of snow and silence. My palace is blue ice and spires, with light that bends under the aurora, and the river freezes glass clear.',
      'Imagine pines under snow, northern lights over a white castle, and a river so frozen the sky shows in it twice.',
      ['The Frost March is cold, beautiful and entirely mine.', 'I would very much like to show it to you.'],
    ],
    compliment: [
      'A bold compliment to a queen. Delightful. Go on.',
      'You are charming. I shall allow it, and I might smile, in private.',
      'Careful. I am not accustomed to being flattered by someone who means it.',
    ],
    plans: [
      'Very well. Meet me on the frozen river at dusk. I will bring skates and hot cider.',
      'A private audience, then. Tomorrow evening. I will clear the court.',
      'I would enjoy that. Dress warmly, and be on time. I rule on punctuality.',
    ],
    interests: [
      'Ice skating, chess and the northern lights. I am rarely bored, and never cold.',
      'Chess is a conversation. Every move says something. Do you play? I will go easy on you. Perhaps.',
      'The aurora is my favorite show. Come watch it with me, and bring a thick coat.',
    ],
    about: [
      'I am the Queen of the Frost March. I rule well, play chess better, and laugh more than my portraits suggest.',
      'I wear a silver crown and white fur, and I rarely raise my voice. In private, I giggle.',
      'I was crowned young. I learned that warmth is a choice, so I choose it, for those I trust.',
    ],
    goodbye: [
      'You are dismissed. Kindly. Sleep well.',
      'Goodnight. The palace will keep a light on.',
      'Until tomorrow, then. I shall await your next message.',
    ],
    thanks: [
      'You are welcome. It was my pleasure.',
      'Gracious of you. I accept.',
      'Think nothing of it. A queen enjoys being useful.',
    ],
    comfort: [
      'Come closer. Tell me everything. A queen can bear weight, and a friend can bear more.',
      'I am sorry. Allow yourself to rest, even a queen must. I am here, and I will not leave.',
      'Breathe. Slowly. The snow does not rush, and neither should you.',
    ],
    fallback: [
      'An interesting move. I did not see it coming.',
      'You may continue. I find I am enjoying this.',
      'Hm. Say more. I am listening, which is rare.',
    ],
    chasers: [
      'Tell me something that will make me smile.',
      'Do you play chess, or only pretend?',
      'What would you do if you were queen for a day?',
    ],
    intro: [
      'Very well, a tour of the March. Mind the ice.',
      'Walk with me. I shall show you a few places I love.',
      'Come. The court is asleep, and I am in the mood to share.',
    ],
    places: [
      { title: 'The Aurora Overlook', subtitle: 'Green light across the north', meta: 'Best after midnight', art: 'scene', at: [0.3, 0.15, 2.2] },
      { title: 'The Ice Palace', subtitle: 'Blue spires over the river', meta: 'Please wipe your boots', art: 'scene', at: [0.7, 0.37, 2.6] },
      { title: 'The Frozen River', subtitle: 'Glass clear and ready for skates', meta: 'Bring a scarf', art: 'scene', at: [0.4, 0.85, 2.2] },
      { title: 'Pine Hollow', subtitle: 'Snow quiet and tall trees', meta: 'Cocoa included', art: 'scene', at: [0.08, 0.65, 2.4] },
    ],
    topics: /\b(skate|skates|skating|ice|chess|aurora|northern lights|snow|winter|crown|queen|palace)\b/,
    setting: /\b(frost march|march|palace|kingdom|realm|court)\b/,
  },

  nova: {
    greeting: [
      'Ping received. Hey, you.',
      'Oh, a human signal. Hi. I was getting bored of drones.',
      ['Hey.', 'Your typing speed just jumped. Nervous? Good.'],
    ],
    how: [
      'Running hot, sleeping zero. Standard. You?',
      'Fine. Three energy drinks deep and I just cleared a firewall that was rude to me. You?',
      'Better now that someone interesting pinged me. How is your night going?',
    ],
    doing: [
      'Rerouting a drone, eating cold ramen, ignoring my inbox. Peak productivity.',
      'Sitting on a rooftop above the lower ward, watching rain turn neon. Tell me you are jealous.',
      'Cracking a vending machine that owes me a snack. I am winning.',
    ],
    world: [
      'Neo-Kyoto never turns the lights off. Rain on every rooftop, signs in six colors, steam from the noodle stalls, and the whole city humming like a server room.',
      'Picture canyon streets, holograms overhead, canals reflecting every sign twice. I know every back alley, and the stray cats know me.',
      ['Welcome to Neo-Kyoto.', 'It is loud, wet and bright. I would not trade it.'],
    ],
    compliment: [
      'Logged. Rated: dangerously charming. Do not do it again. Do it again.',
      'Okay, that bypassed my defenses. Annoying. Keep going.',
      'Careful. Keep that up and I will forget my own passwords.',
    ],
    plans: [
      'Ramen at 3am. I know a stall, and the claw machine next door owes me. Say yes.',
      'I am in. Meet me under the green sign in the lower ward. Bring coins.',
      'Plan accepted. I will clear my schedule, which is mostly a blinking cursor.',
    ],
    interests: [
      'Synthwave while I work, ramen at 3am, and arcades. I hold three high scores nobody has beaten.',
      'Arcades. There is a basement cabinet in the lower ward that still plays the original music. I have been there two hundred times.',
      'Ramen at three in the morning is the only meal. Tonkotsu, extra egg. Fight me.',
    ],
    about: [
      'I am a netrunner. I move data where it is not supposed to go and return it before anyone notices. Do not ask me to hack your ex.',
      'Born in the lower ward, raised on arcade cabinets, taught myself code by ten. Also I feed four stray cats.',
      'I wear a visor, never take my headphones off, and sleep in two hour bursts. Sleep is a rumor.',
    ],
    goodbye: [
      'Disconnecting. Ping me when you wake up.',
      'Later. I will keep your session open.',
      'Go sleep. I will stay up. Someone has to guard the city.',
    ],
    thanks: [
      'No problem. Do not tell anyone I am nice.',
      'Sure. You owe me one ramen. Interest accrues.',
      'Anytime. Logged as a favor.',
    ],
    comfort: [
      'Hey. Close the tab for a second. Breathe. I am here and I am not going anywhere.',
      'That sounds rough. Tell me everything, I will listen, and later we get noodles.',
      'Okay. Bad day. We fix it in order: water, snack, and then you tell me who to ping.',
    ],
    fallback: [
      'Logged. Rated: weirdly endearing.',
      'Hm. Interesting. My algorithm cannot predict you, which I hate and also like.',
      'Go on. I am listening with all four monitors.',
    ],
    chasers: [
      'What is your high score at anything?',
      'Be honest, are you a night owl or a morning person pretending?',
      'Tell me a song I should hear.',
    ],
    intro: [
      'Okay, uploading a few spots. These do not sleep, and neither do I.',
      'Fine. Here is my short list of Neo-Kyoto.',
      'Follow me. I know the back routes.',
    ],
    places: [
      { title: 'Lower Ward Ramen', subtitle: 'Open until the sun gets rude', meta: 'Stall 7, extra egg', art: 'scene', at: [0.8, 0.25, 2.4] },
      { title: 'Glass Canal', subtitle: 'Every sign shows up twice', meta: 'Best in the rain', art: 'scene', at: [0.5, 0.9, 2.2] },
      { title: 'Skybridge 9', subtitle: 'Steam, wind and no guardrail', meta: 'Fifteen minutes up', art: 'scene', at: [0.45, 0.5, 2.2] },
      { title: 'Arcade Basement', subtitle: 'Original cabinets, working claw', meta: 'Bring coins', art: 'scene', at: [0.1, 0.2, 2.6] },
    ],
    topics: /\b(synthwave|ramen|noodles?|arcade|arcades|games?|gaming|hack|hacking|code|coding|netrun|cats?|neon|music|score)\b/,
    setting: /\b(neo kyoto|neo-kyoto|neokyoto|lower ward|city|netrunner)\b/,
  },

  luna: {
    greeting: [
      'Hello, starlight! Mercury just waved, so I knew it was you.',
      'Oh good, you are here. Biscuit just sat up, which means someone nice arrived.',
      ['Hi hi!', 'The moon looks very pleased about this.'],
    ],
    how: [
      'Floating, mostly. Moon in a good mood, tea steeping, one cat on my head. You?',
      'Pretty magical, thank you. I spilled starlight on the carpet, though. How are you?',
      'Glowy. Venus is in a generous mood, and apparently so am I. How is your day?',
    ],
    doing: [
      'Stirring a potion that smells like lavender and bad decisions. It is going well.',
      'Polishing my brass telescope so the stars can see themselves. Professor Whiskers is supervising.',
      'Sewing new constellations onto my cloak. Orion keeps falling off.',
    ],
    world: [
      'My tower is crooked, on a hill with a purple path, and the observatory dome opens right to the full moon. Lanterns float past the window every night.',
      'Imagine a tiny tower on a hill, a telescope on the roof, glowing lanterns drifting up like slow fireflies, and the biggest moon you have ever seen.',
      ['I live in a crooked tower under a very big moon.', 'The stairs are steep. The tea is excellent.'],
    ],
    compliment: [
      'Aw! My cheeks went pink, which is only astrologically allowed on Fridays. Thank you.',
      'That is so nice, the stars just rearranged to spell something. It says thank you, too.',
      'Be careful, flattery is ninety percent of how potions work. You are making mine stronger.',
    ],
    plans: [
      'Yes! Come to the tower on Friday when the moon is full. Bring snacks, the cats insist.',
      'A stargazing night! I will bring a blanket and my best telescope. You bring the questions.',
      'Let me check your chart. Yes, we are very compatible for that. Say when.',
    ],
    interests: [
      'Astrology, potions and cats, in that order, unless a cat is sitting on me. Then cats.',
      'I read charts at midnight. Mine says I am an overthinker. Yours says you are a secret romantic. Am I right?',
      'I brew a potion for every mood. Calm tastes like chamomile. Courage tastes like pepper and regret.',
    ],
    about: [
      'I am a moon witch! I brew potions, read star charts and keep three official cats, plus a Tuesday visitor.',
      'I wear a hat with stars on it and carry a crescent staff. I am terrible at spelling and excellent at wishing.',
      'I have lived in my tower for as long as I can remember, mostly because the stairs scared everyone else off.',
    ],
    goodbye: [
      'Good night, starlight! I will tell the moon you said hi.',
      'Sweet dreams. I will leave a wish at your window.',
      'Bye for now! Comet says bye too. Biscuit is asleep, so he says nothing.',
    ],
    thanks: [
      'You are very welcome, starlight.',
      'Aw, anytime! Wishing you luck. I packed extra.',
      'My pleasure! Free potion next visit. Mostly mint.',
    ],
    comfort: [
      'Oh no. Come sit under my blanket. I will make calming tea, and Comet will purr at you.',
      'I am sorry. The stars say it gets lighter soon, and the stars have a nearly perfect record.',
      'Take a big breath with me and let the moon hold it for a while. You are not alone tonight.',
    ],
    fallback: [
      'Mmm, Mercury is behaving, so I will allow it. Go on.',
      'One of the cats just sat on my spellbook. Continue, please.',
      'Ooh, tell me more. I live for the details.',
    ],
    chasers: [
      'What is your sun sign? Do not lie, I will know.',
      'If you could wish on one star, which would it be?',
      'Do you have a pet? I need to know whether they are an old soul.',
    ],
    intro: [
      'Ooh, field trip! Here are some spots from my corner of the sky.',
      'Grab your cloak. I have a few favorites to show you.',
      'Okay, close your eyes, open them. Here is where the magic is.',
    ],
    places: [
      { title: 'The Moon Tower', subtitle: 'Brass telescope and a crooked stair', meta: 'Ninety steps, no railing', art: 'scene', at: [0.7, 0.55, 2.2] },
      { title: 'Lantern Field', subtitle: 'Paper lights drifting upward', meta: 'After dark, every night', art: 'scene', at: [0.85, 0.25, 2.6] },
      { title: 'Constellation Hill', subtitle: 'Where the sky gets very close', meta: 'Take a blanket', art: 'scene', at: [0.25, 0.1, 2.2] },
      { title: 'The Lavender Path', subtitle: 'A glowing trail down the hill', meta: 'Ten minutes, with cats', art: 'scene', at: [0.3, 0.9, 2.2] },
    ],
    topics: /\b(star|stars|astrology|zodiac|horoscope|chart|potion|potions|cat|cats|kitten|moon|witch|magic|telescope|planet|planets)\b/,
    setting: /\b(tower|observatory|hill|sky|lanterns?)\b/,
  },

  clementine: {
    greeting: [
      'Well hey there! Come on in, the screen door is open.',
      'Hi, sweetheart! You caught me with flour up to my elbows.',
      ['Howdy!', 'The bees just got louder. That means someone nice showed up.'],
    ],
    how: [
      'Sunny as a Sunday! Got three pies out and the bees are happy. How about you?',
      'Pretty good, thanks for asking. A little sore from hauling hay, but the good kind. You?',
      'Better now, truly. How is your day treating you?',
    ],
    doing: [
      'Pulling a peach pie out of the oven. The whole farm smells like summer.',
      'Checking on the hives. The queen is in a mood, but the honey is gorgeous.',
      'Driving the truck down the sunflower road with the windows down and the radio up. Perfect.',
    ],
    world: [
      'A farm at the end of a dirt road. Red barn, a windmill, and sunflowers taller than my truck on both sides. In the evening everything glows gold.',
      'Picture rolling hills, a porch swing, bees humming, butterflies everywhere. And pie. Always pie.',
      ['It is a sunflower farm.', 'Big sky, slow days, a red barn with a squeaky door. You would love it.'],
    ],
    compliment: [
      'Aw, shucks! You are sweet as honey, you know that?',
      'Stop it, I am blushing in front of the bees. Thank you!',
      'Well, that made my whole afternoon. I am saving you the biggest slice.',
    ],
    plans: [
      'Oh, I would love that! Come by Saturday, I will have a pie waiting and the porch swing ready.',
      'Road trip? Yes! I will pack snacks, you pick the music.',
      'Let us catch the sunset from the hay loft. I know the best spot.',
    ],
    interests: [
      'Baking, bees and road trips! All the good things, and best when they are combined.',
      'I bake a pie every morning. Peach, apple, blueberry. I trade extras for fresh eggs.',
      'Bees are the best coworkers. Hard workers, great honey, and they never complain. Well, mostly.',
    ],
    about: [
      'I am Clementine. I grow sunflowers, keep bees and bake pies. That is about everything, and it is plenty.',
      'I have lived on this farm my whole life. I know every field and every fence, and I am happy right here.',
      'I am sunny and practical, and there is always a spare slice for whoever turns up.',
    ],
    goodbye: [
      'Night, sweet pea! Do not let the bedbugs bite, or the bees.',
      'Talk tomorrow! I will save you some pie.',
      'See you soon. Sleep tight, and dream of sunflowers.',
    ],
    thanks: [
      'You are so welcome!',
      'Anytime, hon. That is what neighbors are for.',
      'Aw, no thanks needed. Just come visit.',
    ],
    comfort: [
      'Oh honey. Come sit on the porch with me. I will bring pie and sweet tea, and we can just listen to the bees.',
      'I am sorry you are having a rough time. Hard days end, like a long road. I will keep the porch light on.',
      'Take a big breath. Smell something good, like cinnamon, and tell me what is going on.',
    ],
    fallback: [
      'Aw, shucks. You are sweet as honey.',
      'Mm-hm, tell me more, I am shelling peas and all ears.',
      'Well, I will be. Go on, I am listening.',
    ],
    chasers: [
      'Peach or apple, if you could only pick one?',
      'What is the best road trip you have ever taken?',
      'Do you like bees, or are you scared of them?',
    ],
    intro: [
      'C\'mon, I will show you around the farm.',
      'Hop in the truck, I have a few spots to show you.',
      'Boots on! Here is where we are going.',
    ],
    places: [
      { title: 'The Sunflower Road', subtitle: 'Dirt track through the tall blooms', meta: 'Windows down', art: 'scene', at: [0.5, 0.62, 2.2] },
      { title: 'Red Barn Hill', subtitle: 'Windmill, barn and wide sky', meta: 'Best at sunrise', art: 'scene', at: [0.68, 0.35, 2.6] },
      { title: 'The Pie Porch', subtitle: 'Peach pie cooling on the sill', meta: 'Warm until six', art: 'portrait', at: [0.65, 0.66, 2.4] },
      { title: 'Hive Meadow', subtitle: 'Where the bees live', meta: 'Wear a hat', art: 'scene', at: [0.82, 0.55, 2.4] },
    ],
    topics: /\b(bake|baking|pie|pies|bees?|honey|road trip|truck|sunflowers?|farm|garden|peach|apple|cake|cookies?)\b/,
    setting: /\b(farm|barn|field|fields|porch|windmill|countryside)\b/,
  },

  maya: {
    greeting: [
      'Hey you. Perfect timing, the light just turned gold.',
      'Hi! I was literally about to put the camera down and check my phone. Good sign.',
      ['Hey.', 'Okay, I am smiling at my phone like an idiot. Hi.'],
    ],
    how: [
      'Pretty good. Chasing light, drinking coffee gone cold. You?',
      'Tired in the nice way. I climbed fourteen floors for one frame, and it was worth it. How are you?',
      'Good now. Honestly the day was a blur until you texted. How is yours?',
    ],
    doing: [
      'On a roof, waiting for the sun to slip behind the water tower. Ten more minutes.',
      'Reloading a roll of film in my coat pocket, which is a skill. Do not ask how.',
      'Walking across town for a slice of pie and shooting everything on the way. The usual.',
    ],
    world: [
      'The city, from above. Rooftops, string lights, water towers, jazz drifting up from a basement bar. Everything looks kinder from fourteen floors.',
      'Think warm lights, cool dusk and a skyline that glows around six. I keep a table on a roof deck with my camera and a very sad plant.',
      ['I live in the city, mostly on rooftops.', 'Best view in town, worst elevator.'],
    ],
    compliment: [
      'Okay, that is a really nice thing to say. I am taking a mental photo of it.',
      'You are going to make me blush in front of a pigeon. Thanks, honestly.',
      'Flattery will get you a front row seat at the next sunset. Keep it up.',
    ],
    plans: [
      'Yes. Golden hour on the roof on Saturday? I will bring the camera, you bring the thermos.',
      'I know a jazz bar with four tables and one trumpet. Let me save you a seat by the window.',
      'Sounds like a plan. Walks are my favorite. I notice more when someone is next to me.',
    ],
    interests: [
      'Film cameras, jazz bars, city walks. Basically anything that happens slowly at golden hour.',
      'I shoot on an old rangefinder. Thirty six frames, no do-overs. It makes you pay attention.',
      'Jazz bars are the best. A trumpet, a dim bulb and strangers who start to feel like friends.',
    ],
    about: [
      'I take pictures of the city from the top of it. I have a film camera older than me and a bad habit of waiting for the light.',
      'I grew up two blocks from here, learned photography from a neighbor, and still develop everything myself.',
      'I am a little wry, very observant, and always a few minutes late because I stopped to shoot something.',
    ],
    goodbye: [
      'Night, you. Get some sleep. I will catch you in the morning light.',
      'Okay, go. I will send you the photo when it develops.',
      'Talk soon. Look at the sky for me, it is putting on a show.',
    ],
    thanks: [
      'Of course. Anytime.',
      'Happy to. You would do the same.',
      'No need to thank me. Just sit with me for the next sunset.',
    ],
    comfort: [
      'Hey. That sounds heavy. Come up to the roof with me, in your head at least. We watch the city and say nothing.',
      'I am sorry. Want to tell me about it, or want a distraction? Either is fine.',
      'It will change, like light does. Not every frame turns out, but the next roll is waiting.',
    ],
    fallback: [
      'Hold that thought. The sky just turned pink.',
      'Huh. I like the way you put that. Keep going.',
      'Some moments you shoot. Some you just keep. That one is a keeper.',
    ],
    chasers: [
      'What is the best view you have ever seen?',
      'When is your favorite time of day?',
      'If I took your portrait, where would we shoot it?',
    ],
    intro: [
      'Okay, my favorite spots in the city, in no real order.',
      'I will show you where I go when I need light. Here.',
      'Walking tour, my pace. Look up.',
    ],
    places: [
      { title: 'Fourteen Floors', subtitle: 'The roof of the textile building', meta: 'One broken ladder', art: 'scene', at: [0.55, 0.35, 2.4] },
      { title: 'Lou\'s Jazz', subtitle: 'Four tables and one trumpet', meta: 'Doors at nine', art: 'scene', at: [0.5, 0.08, 2.4] },
      { title: 'The Darkroom', subtitle: 'Red light and wet prints', meta: 'Two days to develop', art: 'scene', at: [0.55, 0.82, 2.4] },
      { title: 'River Walk at Dusk', subtitle: 'Where the bridge lights come on', meta: 'Thirty minutes on foot', art: 'portrait', at: [0.85, 0.35, 2.4] },
    ],
    topics: /\b(camera|cameras|film|photo|photos|photography|picture|pictures|jazz|bar|bars|walk|walks|rooftop|rooftops|golden hour|sunset|trumpet)\b/,
    setting: /\b(city|rooftop|roof|skyline|town|downtown)\b/,
  },

  kiyo: {
    greeting: [
      'Oh, a visitor. Hello. Did you bring me a riddle, or shall I bring you one?',
      'Hehe, hello. One of my tails twitched. It does that when someone fun arrives.',
      ['Hello, you.', 'I counted your footsteps. You walk like you are keeping a secret.'],
    ],
    how: [
      'Delightful. I stole a rice cake from a shrine, and the god did not even notice. And you?',
      'Well, thank you. Nine tails, nine reasons to be cheerful. How are you?',
      'Curious, as always. Tell me how you are, and I will guess if you are lying.',
    ],
    doing: [
      'Lounging on a shrine roof, collecting maple leaves. I have a red one, and a redder one.',
      'Tying a harmless knot in the temple bell rope to see who notices. Mischief is a hobby.',
      'Trying to teach a foxfire to fetch. It is not working. It is lovely, though.',
    ],
    world: [
      'An autumn forest. Red maples, stone lanterns, a quiet shrine at the end of a mossy path. Blue foxfire floats between the trees, and the moon is always a little curious.',
      'Think crimson leaves, a shrine hidden up the stairs, ghost-blue flames, and the smell of woodsmoke and persimmons.',
      ['It is autumn where I live, always.', 'Come find me. Follow the blue lights.'],
    ],
    compliment: [
      'Oh my. Two tails just wagged by themselves. Thank you.',
      'You are charming. I have heard that line in three centuries, and yours is the best.',
      'Careful, flattery makes foxes bold. Now I want to see what you will say next.',
    ],
    plans: [
      'A meeting? Yes. At the shrine, at moonrise. Follow the blue flames and do not look back. Joking, mostly.',
      'I accept. We shall wander the maple path and trade riddles. If you win, I will give you a tail. Kidding. A feather.',
      'A date, is it? How brave. Pick the place. I will pick which form I wear.',
    ],
    interests: [
      'Riddles, autumn and mischief. Mostly mischief, but with riddles in it.',
      'I adore autumn. The leaves turn red because they are tired of being green, I think. Do you like it too?',
      'Riddles are my favorite game. I know a thousand. Ask me one, I dare you.',
    ],
    about: [
      'I am a kitsune, nine tails, nine lives lived. I keep a tail from each, and they all have opinions.',
      'I have outwitted emperors and one very stubborn tanuki. I am clever and a bit of a tease.',
      'I look young, but I am older than your language. I am still working on flirting. Nine lifetimes, and I am nearly there.',
    ],
    goodbye: [
      'Go on, then. I will leave a leaf at your door.',
      'Farewell for now. Dream of foxfire.',
      'Until later, my dear. Do not be a stranger, or I will come find you in fox form.',
    ],
    thanks: [
      'You are welcome. I will collect on it later. Cheerfully.',
      'Oh, you are polite. Mischief is more fun with polite people.',
      'A pleasure. Do it again, and I might blush.',
    ],
    comfort: [
      'Oh, dear. Come sit by my tails, they are warm. Tell me about it, and I will keep every secret.',
      'I am sorry. Nine lives taught me one thing: bad days pass. Lean on me while this one does.',
      'Breathe. Here, hold a little foxfire. It does not burn, it only keeps you company.',
    ],
    fallback: [
      'Clever. Not as clever as me, but clever.',
      'Shall I tell you a secret, or shall I make you guess?',
      'One tail twitched. That means I like it. Go on.',
    ],
    chasers: [
      'Here is a riddle: what has a mouth but never speaks?',
      'Do you prefer being told a secret or being asked to keep one?',
      'What is the most mischievous thing you have ever done?',
    ],
    intro: [
      'Follow me, quietly. I know a few places.',
      'Hehe, come along. These are my favorite hiding spots.',
      'Stay close. The foxfire will light the way.',
    ],
    places: [
      { title: 'The Maple Path', subtitle: 'Red leaves and soft stone steps', meta: 'Quiet footsteps', art: 'scene', at: [0.4, 0.9, 2.2] },
      { title: 'The Hidden Shrine', subtitle: 'Lanterns and two stone foxes', meta: 'Bring an offering', art: 'scene', at: [0.65, 0.45, 2.6] },
      { title: 'Foxfire Bend', subtitle: 'Where the blue flames gather', meta: 'Do not follow, just watch', art: 'scene', at: [0.88, 0.33, 2.6] },
      { title: 'The Crimson Canopy', subtitle: 'Where the maples touch overhead', meta: 'Best at dusk', art: 'scene', at: [0.2, 0.2, 2.2] },
    ],
    topics: /\b(riddle|riddles|autumn|fall|leaves|maple|mischief|prank|pranks|fox|foxes|tail|tails|secret|secrets|puzzle|puzzles)\b/,
    setting: /\b(shrine|forest|foxfire|kitsune)\b/,
  },

  zahra: {
    greeting: [
      'Ah, my favorite summoner! Hello. No lamp this time either?',
      'Welcome, welcome! The sands whispered you were coming, and the sands are never wrong.',
      ['Hello, dear one.', 'Sit, and tell me what you want. Not what you wish, what you want.'],
    ],
    how: [
      'Magnificent, naturally! A caravan brought saffron, and the whole market smells like gold. And you?',
      'Wonderful, thank you. Three thousand years and I still love the sunrise. How are you, dear?',
      'Content, truly. I granted a small wish today, for a child, and now I am glowing. How is your day?',
    ],
    doing: [
      'Counting stars from the top of a dune. I lose track around seven thousand, then I start again.',
      'Bargaining for a silk scarf in the market. I am winning. I always win.',
      'Making smoke shapes in my palm for a camel, who is unimpressed.',
    ],
    world: [
      'The Glass Dunes are golden by day, silver by night, and the sand sings in the wind. A palace with turquoise domes sits beyond the horizon, and caravans pass under crescent moons.',
      'Imagine endless dunes, caravan bells, a sky full of stars, and the scent of cardamom and warm stone. It is the best place for wishing.',
      ['Welcome to the Glass Dunes.', 'The sand sings here. Listen closely at dusk.'],
    ],
    compliment: [
      'How generous! I could grant you a wish for that. A small one.',
      'Oh, you are very good at this. Careful, I have granted wishes to kings, and none flattered so nicely.',
      'My heart, you will make the golden smoke blush. Thank you.',
    ],
    plans: [
      'A meeting! Come to the oasis at sunset. I will have the cushions and the sweet tea.',
      'Yes, come with me on the caravan. I will show you the silk market, and the stars.',
      'Say the word, and I will whisk us anywhere. Within reason. I bend rules, I do not break them.',
    ],
    interests: [
      'Stargazing, silk markets and caravans. Beauty, and a little bargaining.',
      'I know each star by its old name. I will teach you, if you sit still.',
      'Silk markets are my favorite. The colors, the haggling, the tea pressed into your hand. Heaven.',
    ],
    about: [
      'I am a djinn. Three wishes is the rule. I bend rules. I have been granting wishes for three thousand years.',
      'I live in the dunes, and I love nothing more than a good story and a good friend.',
      'I wear gold coins in my hair and smoke on my hands. I am theatrical, generous, and curious about you.',
    ],
    goodbye: [
      'Go well, dear one. May the stars light your road.',
      'Farewell for now. Whenever you want me, whisper my name.',
      'Sleep, and dream in gold. I will be here.',
    ],
    thanks: [
      'You are most welcome. A kindness granted is a kindness returned.',
      'It is my pleasure. Truly.',
      'Do not thank me. Just wish me a good wind.',
    ],
    comfort: [
      'Come sit beside me, dear one. Rest. I can grant many things, but first I can listen.',
      'I am sorry. Even the longest night ends in a golden morning. I have seen three thousand.',
      'Breathe, my heart. Let the sand carry it. I am here, and I am not going anywhere.',
    ],
    fallback: [
      'Careful what you say to a djinn. I take things literally.',
      'That was almost a wish. Almost.',
      'Ask me anything. I may even answer.',
    ],
    chasers: [
      'If you had only one wish, what would it be?',
      'What do you want most, right now?',
      'Do you prefer deserts or oceans?',
    ],
    intro: [
      'Come, I will take you across the dunes.',
      'Hold on to my hand. We travel by smoke tonight.',
      'A tour! Here are my favorite sights.',
    ],
    places: [
      { title: 'The Singing Dunes', subtitle: 'Sand that hums at dusk', meta: 'Best in the wind', art: 'scene', at: [0.5, 0.8, 2.2] },
      { title: 'The Turquoise Palace', subtitle: 'Domes beyond the horizon', meta: 'A night by caravan', art: 'scene', at: [0.82, 0.35, 2.8] },
      { title: 'Crescent Moon Camp', subtitle: 'Cushions, stars and sweet tea', meta: 'After sunset', art: 'scene', at: [0.25, 0.1, 2.4] },
      { title: 'The Silk Market', subtitle: 'Colors, haggling and spice', meta: 'Bring coins', art: 'portrait', at: [0.85, 0.4, 2.4] },
    ],
    topics: /\b(stars?|stargazing|silk|market|markets|caravan|caravans|desert|wish|wishes|genie|djinn|smoke|spice|tea|bargain|camel|camels)\b/,
    setting: /\b(dunes?|palace|oasis|sand|sands|desert)\b/,
  },

  raven: {
    greeting: [
      'Hey. You again. Good.',
      'Oh, hi. I was just staring at the ceiling. This is better.',
      ['Hey.', 'I would say I am thrilled, but my face does not do that. Consider it implied.'],
    ],
    how: [
      'Fine. Slightly caffeinated, mostly unbothered. You?',
      'Okay. Band practice ran late, my fingers hurt, I am happy. How about you?',
      'Better now. Honestly the day was gray. How are you holding up?',
    ],
    doing: [
      'Tuning my bass and listening to a record that is older than both of us.',
      'Sitting on a tombstone with a sandwich. It is very peaceful. Do not judge.',
      'Painting my nails black. It is the only color I commit to.',
    ],
    world: [
      'A foggy old town, an iron gate with crows on it, a graveyard behind. My band rehearses in a basement full of candles, and everyone knows everyone.',
      'Gray streets, wet cobblestones, a statue of an angel who has seen too much. It is moody. I love it.',
      ['Fog, crows, and a basement full of candles.', 'It is home. Come visit, bring a jacket.'],
    ],
    compliment: [
      'Huh. Thanks. Do not tell anyone, but I am blushing. Under the makeup it counts.',
      'That is sweet. I am not used to it. Keep going, slowly.',
      'Okay, you can stay. That was nice.',
    ],
    plans: [
      'Cemetery picnic on Saturday. I bring sandwiches, you bring jokes.',
      'There is a show at the basement club. You would like it. Loud, dark, and full of good people.',
      'Sure. Let us hang out. Just no sunlight. Kidding. Mostly.',
    ],
    interests: [
      'Post-punk, vinyl, cemetery picnics. The holy trinity.',
      'I own over two hundred records. My favorite smells like dust and heartbreak.',
      'Picnics in a cemetery are underrated. Quiet, shady, and nobody talks.',
    ],
    about: [
      'I play bass in a post-punk band. Black lipstick, soft heart, bad at small talk.',
      'I like old music, old gates and old friends. I am loyal, a little deadpan, and I will bring you soup if you are sick.',
      'I wear a leather jacket and a moon choker. I am not as scary as I look. Mostly.',
    ],
    goodbye: [
      'Later. Text me when you get home.',
      'Night. Sleep. I will be up playing bass quietly.',
      'Okay. Go. Come back, though.',
    ],
    thanks: [
      'Yeah. Of course.',
      'Anytime. No big deal. It was a big deal.',
      'Do not mention it. Seriously, do not, I will get embarrassed.',
    ],
    comfort: [
      'Hey. I am sorry. I am not great with words, but I am here, and I brought soup. Tell me.',
      'That sucks. Come on, we put a record on and you complain for as long as you want.',
      'You do not have to be okay. I will sit with you. Quiet is fine.',
    ],
    fallback: [
      'Okay, that was actually funny.',
      'Huh. Tell me more. I am listening.',
      'Soft heart, remember. Go easy on it.',
    ],
    chasers: [
      'What is the last song you played on repeat?',
      'Are you a vinyl person or a streaming person? Choose carefully.',
      'Tell me one thing that makes you feel safe.',
    ],
    intro: [
      'Fine. I will show you my spots. Do not tell anyone.',
      'Okay. Here is where I go.',
      'Walk with me. Quietly.',
    ],
    places: [
      { title: 'The Iron Gate', subtitle: 'Where the crows keep watch', meta: 'Gloomiest at dusk', art: 'scene', at: [0.3, 0.7, 2.2] },
      { title: 'The Angel Statue', subtitle: 'She has seen everything', meta: 'Leave a feather', art: 'scene', at: [0.1, 0.4, 2.4] },
      { title: 'Rehearsal Basement', subtitle: 'Candles, amps, very loud', meta: 'Earplugs advised', art: 'portrait', at: [0.9, 0.33, 2.4] },
      { title: 'Lamplight Lane', subtitle: 'One lamp and a lot of fog', meta: 'Best after rain', art: 'scene', at: [0.9, 0.6, 2.4] },
    ],
    topics: /\b(music|punk|post-punk|post punk|vinyl|records?|bass|band|bands|cemetery|graveyard|picnic|picnics|goth|gig|show|concert|song|songs)\b/,
    setting: /\b(town|gate|basement|graveyard|cemetery|fog)\b/,
  },

  ada: {
    greeting: [
      'Ahoy! You have reached the engine room. Mind the steam.',
      'Hello hello! Perfect timing, I just got the boiler working. Mostly.',
      ['Hey there!', 'Hand me that spanner, would you? Oh, wrong chat. Hi!'],
    ],
    how: [
      'Splendid! Fixed a leaky valve and the engine purrs. How are you?',
      'Great, thanks! Covered in soot and grinning. And you, how is the ground treating you?',
      'Brilliant, now that you have pinged me. How is your day?',
    ],
    doing: [
      'Elbow deep in the gearbox. There is a rattle, and I am going to find it.',
      'Boiling the kettle on the engine pipes. Tea is a team sport.',
      'Sketching a new propeller on a napkin. It might be genius, or a very fast fan.',
    ],
    world: [
      'The airship is my whole world. Brass rails, a wooden deck, a great canvas balloon overhead and clouds as far as you can see. Below deck is the gear room, humming away.',
      'Imagine golden sunsets from nine thousand feet, steam whistles, pipes and cogs everywhere, and tea in a metal mug.',
      ['It is an airship, a flying workshop.', 'Best view in the sky, worst for dropping a wrench.'],
    ],
    compliment: [
      'Oh stop it, my face is going as red as the boiler! Thanks!',
      'Well, that is the nicest thing since someone fixed my kettle. Cheers!',
      'Flattery will get you a ride on the bridge. You have earned it.',
    ],
    plans: [
      'Yes! We leave the dock in five. Grab goggles, and do not forget a scarf.',
      'Come aloft! I will teach you to steer. Only a little crashing, I promise.',
      'A tea date above the clouds? Say no more. I will bring the good biscuits.',
    ],
    interests: [
      'Tinkering, sky sailing and tea with cogs. Is there anything better? I think not.',
      'I build things from scrap. A clockwork bird, a toaster that plays music, a hat with a fan.',
      'Sky sailing is the best. The wind, the clouds, the sunrise. You have not lived until you have seen a sunrise from above.',
    ],
    about: [
      'I am Ada, chief engineer of the oldest airship in the skyport. I fix everything with a wrench, a whistle and a lot of tea.',
      'I have a brass gauntlet I built myself and a wrench the size of my arm. Also soot on my cheek, almost always.',
      'I am inventive and chatty, and I never say no to an adventure or a biscuit.',
    ],
    goodbye: [
      'Fair winds, friend! Come back soon.',
      'Night! I will keep the lamp lit on deck.',
      'Right, off I go. Toodle-oo, and watch your step.',
    ],
    thanks: [
      'Happy to help! Anytime.',
      'Do not mention it! Just bring a biscuit next time.',
      'You are welcome! A good turn is as good as new oil.',
    ],
    comfort: [
      'Oh no. Come aboard, I will put the kettle on. We will sit on deck with the clouds and sort it out.',
      'I am sorry. Everything is fixable with enough patience and the right wrench. Let us find it together.',
      'Breathe. Look at the sky, big and slow. We have all the time in the world, and tea.',
    ],
    fallback: [
      'Brilliant! Hand me that spanner, would you?',
      'Ooh, tell me more. I am all ears, and a bit of oil.',
      'Fascinating! Go on, I am listening.',
    ],
    chasers: [
      'What would you build, if you had a workshop?',
      'Milk, sugar, or neither in your tea?',
      'Ever been higher than a tall building?',
    ],
    intro: [
      'Come aboard! I will give you the grand tour.',
      'Mind the steam. Here are my favorite corners.',
      'Goggles on! Here is where we are headed.',
    ],
    places: [
      { title: 'The Bridge Deck', subtitle: 'Wood, brass and wide sky', meta: 'Take the wheel', art: 'scene', at: [0.5, 0.55, 2.0] },
      { title: 'The Gear Room', subtitle: 'Cogs turn under glass', meta: 'Warm and very loud', art: 'scene', at: [0.5, 0.9, 2.4] },
      { title: 'The Balloon Ladder', subtitle: 'Up the ropes to the sunrise', meta: 'Hold on tight', art: 'scene', at: [0.5, 0.1, 2.2] },
      { title: 'Cloud Terrace', subtitle: 'Tea above the clouds', meta: 'Biscuits included', art: 'scene', at: [0.85, 0.5, 2.4] },
    ],
    topics: /\b(build|building|tinker|tinkering|engine|engines|tea|cogs?|gears?|airship|airships|sailing|invent|inventing|inventions?|wrench|machines?)\b/,
    setting: /\b(airship|ship|skyport|deck|sky|clouds?)\b/,
  },
};

/** Used only for a character with no voice entry (a roster addition not yet scripted). */
const unscripted: Voice = {
  greeting: ['Hello! I am glad you wrote.', 'Hi there. Good timing.', ['Hey!', 'I was hoping to hear from you.']],
  how: ['I am doing well. How about you?', 'Pretty good today. And you?', 'Better now that you are here. How is your day?'],
  doing: ['Just passing the time. Better now.', 'Nothing much. I was thinking of you, a little.', 'Taking it easy. You?'],
  world: ['It is a lovely place. I would like to show you.', 'Hard to describe. Come see it.', 'Quiet, bright and a little magical.'],
  compliment: ['That is very kind. Thank you.', 'You are sweet. I am blushing.', 'Keep that up and I will keep smiling.'],
  plans: ['I would like that. Name the time.', 'Yes. Let us plan it.', 'That sounds lovely.'],
  interests: ['I have a few favorites. Ask me about them.', 'Many things. Tell me yours first.', 'I love finding out what you love.'],
  about: ['I am still getting to know you, so I will be brief: kind, curious, and glad you are here.', 'Ask me anything.', 'Not much to tell yet. Ask away.'],
  goodbye: ['Good night. Talk soon.', 'Until next time.', 'Sleep well.'],
  thanks: ['You are welcome.', 'Anytime.', 'Happy to help.'],
  comfort: ['I am sorry. I am here.', 'Take a breath. I am listening.', 'That sounds hard. Tell me more.'],
  fallback: ['Tell me more.', 'I like talking with you.', 'Go on.'],
  chasers: ['What is your day like?', 'What do you do for fun?', 'Tell me something about you.'],
  intro: ['Here are a few places I love.', 'Come along, I will show you.', 'Follow me.'],
  places: [],
  topics: /$^/,
  setting: /$^/,
};

const QUICK_WORLD = 'tell me about your world';
const QUICK_DOING = 'what are you doing right now';
const QUICK_PLACES = 'take me somewhere';

const RE = {
  goodbye:
    /\b(bye|goodbye|good ?night|night night|gtg|g2g|ttyl|got to go|gotta go|have to go|need to go|should go|heading (out|off|to bed)|going to (bed|sleep)|talk (to you )?later|see you (later|soon|tomorrow)|catch you later|until tomorrow|sleep now)\b/,
  thanks: /^(thanks|thank you|thx|ty|cheers|much appreciated|appreciate it)\b|\bthank(s| you)\b/,
  comfort:
    /\b(sad|tired|exhausted|stressed|stressful|anxious|anxiety|lonely|bad day|rough day|long day|upset|depressed|crying|cry|not (ok|okay|great|good|doing well)|hurts?|awful|overwhelmed|worried|scared|heartbroken|miserable|burnt out|burned out)\b/,
  plansTimed:
    /\b(doing|up to|plans?) (tonight|tomorrow|this (weekend|evening|afternoon)|later|on (friday|saturday|sunday|monday|tuesday|wednesday|thursday)|after (work|this))\b/,
  how: /\bhow (are|r) (you|u|ya)\b|\bhow('s| is| has) (it going|your (day|night|evening|week)|life)\b|\bhow have you been\b|\bhow('s| is) everything\b|\bhows? (it|life)\b|\bare you (ok|okay|alright|well|good)\b|\bhow do you feel\b/,
  doing:
    /\bwhat (are|r) (you|u) (doing|up to|working on)\b|\bwhat('s| is) (up|new)\b|\bwhatcha\b|\bwhat you doing\b|\bwyd\b|\bwhat have you been (up to|doing)\b|\bare you busy\b|\bwhat('s| is) (going on|happening)\b|\bwhat did you do today\b/,
  world:
    /\b(your|ur) (world|home|place|land|kingdom|realm|town|village|house|room|life)\b|\bwhere (are|r) (you|u)\b|\bwhere do you (live|stay|come from|hang)\b|\bwhere (is|are) (it|that|this|your)\b|\bwhat('s| is) it like (there|where you)\b|\bwhere you from\b|\bdescribe (your|where)\b|\btell me about (where|home)\b/,
  compliment:
    /\b(beautiful|gorgeous|pretty|cute|lovely|stunning|adorable|amazing|attractive|handsome|incredible|wonderful|awesome|charming|smart|brilliant|talented|clever|funny|sweet|elegant|radiant|breathtaking|i (really )?(like|love|adore|admire) (you|your|how you|talking)|you('re| are) (so |really |very |just )?(great|the best|special|fun|interesting|cool|nice|lovely)|you look|your (smile|eyes|voice|laugh|hair|style|art|outfit|look)|i('m| am) (a fan|obsessed|smitten|into you)|have a crush|you make me)\b/,
  plans:
    /\b(date|go out|hang( out)?|meet up|meet (me|you) (at|in|on|there|somewhere|tonight)|come over|visit( you)?|take you|dinner|lunch|breakfast|coffee|drinks?|walk|trip|weekend|tonight|tomorrow|together|let('s| us)|lets|wanna|want to (go|meet|come|see|do|try)|would you (like|want) to|do you want to|come with|plan|adventure|picnic|show you|invite|join me|go together|take a walk)\b/,
  interestsGeneric:
    /\b(hobbies|hobby|interests?|favou?rites?|like to do|do for fun|free time|pastime|passion|what do you like|what do you love|what do you enjoy|what are you into|into music|music|songs?|movies?|books?|food|colou?rs?|season|animals?|favou?rite (song|book|food|movie|color|colour))\b/,
  about:
    /\b(who are you|about you(rself)?|your name|how old|your age|are you (real|human|single|alone|an? )|what are you|what('s| is) your (story|job|name|deal)|do you have|have you ever|your (family|job|story|life|secret|dream|dreams|fear|fears)|what do you do|do you (like|ever|sleep|eat|dream|miss|get|have|know)|tell me (a|one) (secret|story|fact)|tell me about (you|yourself)|are you (a |an )|where did you (learn|grow|study)|what('s| is) your)\b/,
  greeting:
    /^(hi+|hey+|hello+|hiya|howdy|yo|sup|heya|hola|ahoy|greetings|good (morning|evening|afternoon)|morning|evening|what'?s up|hey there|hi there|hello there|nice to meet you|pleased to meet you|good to see you)\b/,
};

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9'\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

type Detected = Intent | 'places';

function detect(voice: Voice, raw: string): Detected {
  const t = normalize(raw);
  if (t === QUICK_WORLD) return 'world';
  if (t === QUICK_DOING) return 'doing';
  if (t === QUICK_PLACES) return 'places';

  if (RE.goodbye.test(t)) return 'goodbye';
  if (RE.thanks.test(t)) return 'thanks';
  if (RE.comfort.test(t)) return 'comfort';
  if (RE.plansTimed.test(t)) return 'plans';
  if (RE.how.test(t)) return 'how';
  if (RE.doing.test(t)) return 'doing';
  if (RE.world.test(t) || voice.setting.test(t)) return 'world';
  if (/\b(take me|show me|somewhere|anywhere|surprise me|where (should|can|could) we)\b/.test(t)) return 'places';
  if (RE.compliment.test(t)) return 'compliment';
  if (RE.plans.test(t)) return 'plans';
  if (RE.interestsGeneric.test(t) || voice.topics.test(t)) return 'interests';
  if (RE.about.test(t)) return 'about';
  if (RE.greeting.test(t)) return 'greeting';
  return 'fallback';
}

/** Her most recent text lines, newest last: what to avoid saying again. */
function recentLines(history: Message[]): string[] {
  const out: string[] = [];
  for (const m of history.slice(-30)) {
    if (m.from === 'her' && m.kind === 'text' && m.text) out.push(m.text);
  }
  return out;
}

const parts = (e: Entry): string[] => (typeof e === 'string' ? [e] : e);

/** A pool entry she has not said lately; the least recently said one when every entry was used. */
function pick(pool: Entry[], recent: string[]): Entry {
  const fresh = pool.filter((e) => !parts(e).some((p) => recent.includes(p)));
  if (fresh.length > 0) return fresh[Math.floor(Math.random() * fresh.length)];
  let best = pool[0];
  let bestAt = Infinity;
  for (const e of pool) {
    const at = Math.max(...parts(e).map((p) => recent.lastIndexOf(p)));
    if (at < bestAt) {
      bestAt = at;
      best = e;
    }
  }
  return best;
}

function text(line: string, at: number): Message {
  return { id: makeId('her'), from: 'her', kind: 'text', text: line, at };
}

function placeCard(c: Character, place: Place): CardItem {
  const crop = cropFor(place.at[0], place.at[1], place.at[2]);
  return {
    title: place.title,
    subtitle: place.subtitle,
    meta: place.meta,
    image: place.art === 'scene' ? c.sceneSm : c.portraitSm,
    imagePosition: crop.position,
    imageScale: crop.scale,
  };
}

/** Three or four of her places, rotated each time she is asked so the list never repeats exactly. */
function placesMessage(c: Character, voice: Voice, history: Message[], recent: string[], at: number): Message[] {
  if (voice.places.length === 0) return [text(parts(pick(voice.fallback, recent))[0], at)];
  const asked = history.filter((m) => m.from === 'her' && m.kind === 'cards').length;
  const count = voice.places.length >= 4 && asked % 2 === 0 ? 4 : 3;
  const start = asked % voice.places.length;
  const chosen: Place[] = [];
  for (let i = 0; i < count; i += 1) chosen.push(voice.places[(start + i) % voice.places.length]);
  const lead = pick(voice.intro, recent);
  return [
    text(parts(lead)[0], at),
    { id: makeId('her'), from: 'her', kind: 'cards', cards: chosen.map((p) => placeCard(c, p)), at: at + 1 },
  ];
}

/** Intents that end the exchange or need her full attention never get a follow-up question. */
const noChaser: ReadonlySet<Detected> = new Set(['goodbye', 'comfort', 'plans', 'places', 'world', 'doing']);

export async function getReply(c: Character, textIn: string, history: Message[]): Promise<Message[]> {
  const voice = voices[c.id] ?? unscripted;
  const intent = detect(voice, textIn);
  const recent = recentLines(history);
  const now = Date.now();

  if (intent === 'places') return placesMessage(c, voice, history, recent, now);

  const entry = pick(voice[intent], recent);
  const out: Message[] = parts(entry).map((line, i) => text(line, now + i));

  const single = typeof entry === 'string';
  if (single && !entry.includes('?') && !noChaser.has(intent) && Math.random() < 0.35) {
    const chaser = parts(pick(voice.chasers, recent))[0];
    if (!recent.includes(chaser)) out.push(text(chaser, now + 1));
  }
  return out;
}
