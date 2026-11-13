// Starting points shown under Generate Media -> Made for You. Each one prefills the Multi-scene Video flow with a
// proven shape (scene order, lengths, transitions). The person still tells us what the video is about, and every
// scene stays editable. Briefs are written generically ("the product") so they fit any brand.
export const SCENE_TEMPLATES = [
  {
    id: 'launch',
    title: 'Product launch teaser',
    text: 'A hook, the product up close, how it is used, and a confident closing shot.',
    aspect: '9:16',
    total: 30,
    scenes: [
      { brief: 'A bold opening shot that makes the viewer stop scrolling: the product appears with dramatic light and a slow push-in.', caption: '', seconds: 5, transition: 'cut' },
      { brief: 'Close-up detail of the product: texture, finish and craftsmanship, slow and tactile, soft light moving across it.', caption: '', seconds: 5, transition: 'fade' },
      { brief: 'The product being used in a real, relaxed moment by a person, natural handheld feel.', caption: '', seconds: 5, transition: 'dissolve' },
      { brief: 'A second use moment in a different setting, showing how it fits into everyday life.', caption: '', seconds: 5, transition: 'fade' },
      { brief: 'A satisfying result shot: the benefit of using the product, a happy reaction, warm light.', caption: '', seconds: 5, transition: 'dissolve' },
      { brief: 'Closing hero shot of the product, steady and centred, with space around it for a call to action.', caption: 'Available now', seconds: 5, transition: 'fade' }
    ]
  },
  {
    id: 'festive',
    title: 'Festive offer',
    text: 'A short, bright reel for a festive sale: celebration, product, offer.',
    aspect: '9:16',
    total: 15,
    scenes: [
      { brief: 'A festive celebration scene: warm lights, decorations and a joyful atmosphere, camera gliding forward.', caption: '', seconds: 5, transition: 'cut' },
      { brief: 'The product presented as the perfect festive gift, being unwrapped or placed among the decorations.', caption: '', seconds: 5, transition: 'fade' },
      { brief: 'A bright closing shot of the product with festive light sparkling around it.', caption: 'Festive offer is live', seconds: 5, transition: 'dissolve' }
    ]
  },
  {
    id: 'story',
    title: 'Lifestyle story',
    text: 'A day-in-the-life story that shows the product woven into real moments.',
    aspect: '9:16',
    total: 30,
    scenes: [
      { brief: 'Early morning, soft daylight through a window, a calm start to the day.', caption: '', seconds: 5, transition: 'cut' },
      { brief: 'The person reaches for the product and uses it, an unhurried, natural moment.', caption: '', seconds: 5, transition: 'fade' },
      { brief: 'Out and about: the person moves through the city with confidence, the product part of their routine.', caption: '', seconds: 5, transition: 'dissolve' },
      { brief: 'A moment with friends or family, laughter, the product visible in the scene.', caption: '', seconds: 5, transition: 'fade' },
      { brief: 'Golden hour: the person relaxes and enjoys the result, warm cinematic light.', caption: '', seconds: 5, transition: 'dissolve' },
      { brief: 'A quiet closing shot of the product resting in its place at the end of the day.', caption: '', seconds: 5, transition: 'fade' }
    ]
  },
  {
    id: 'benefits',
    title: 'Benefits showcase',
    text: 'Three clear benefits, one scene each, then a strong finish. Landscape for YouTube and web.',
    aspect: '16:9',
    total: 30,
    scenes: [
      { brief: 'An establishing shot that sets up the problem the product solves, in a believable everyday setting.', caption: '', seconds: 5, transition: 'cut' },
      { brief: 'Benefit one: show the product in action solving the problem, clear and easy to follow.', caption: 'Benefit one', seconds: 6, transition: 'fade' },
      { brief: 'Benefit two: a different angle that shows a second advantage of the product.', caption: 'Benefit two', seconds: 6, transition: 'dissolve' },
      { brief: 'Benefit three: a close, satisfying demonstration of a third advantage.', caption: 'Benefit three', seconds: 6, transition: 'dissolve' },
      { brief: 'Closing hero shot of the product, calm and confident, wide framing with room for a call to action.', caption: '', seconds: 7, transition: 'fade' }
    ]
  }
];
