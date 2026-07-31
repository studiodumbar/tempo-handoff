/* Catalog + copy, transcribed from the Figma page (node 0:1). */

/* `brand` drives the FILTER control, `sales` drives BEST SELLING, and array
   order is NEWEST. Display name is brand + name: "TEMPO T-SHIRT". */
const APPAREL = [
  { id: "sweatshirt", brand: "Tempo", name: "Sweatshirt", price: 65, sales: 6, sizes: ["XS", "S", "M", "L", "XL"], img: "assets/sweatshirt.png" },
  { id: "t-shirt", brand: "Tempo", name: "T-shirt", price: 20, sales: 9, sizes: ["XS", "S", "M", "L", "XL", "XXL"], img: "assets/tshirt.png" },
  { id: "hoodie", brand: "Tempo", name: "Hoodie", price: 75, sales: 8, sizes: ["XS", "S", "M", "L", "XL"], img: "assets/hoodie.png" },
  { id: "rugby-shirt", brand: "Tempo", name: "Rugby shirt", price: 85, sales: 4, sizes: ["S", "M", "L", "XL"], img: "assets/rugby-shirt.png" },
  { id: "dad-cap", brand: "Tempo", name: "Cap", price: 35, sales: 7, sizes: ["ONE SIZE"], img: "assets/dad-cap.png" },
  { id: "windbreaker", brand: "MPP", name: "Windbreaker", price: 120, sales: 3, sizes: ["S", "M", "L", "XL"], img: "assets/windbreaker.png" },
  { id: "beanie", brand: "MPP", name: "Beanie", price: 30, sales: 5, sizes: ["ONE SIZE"], img: "assets/beanie.png" },
];

/* Accessories are sizeless — the spec panel drops the SIZE row (per "View Accessories"). */
const ACCESSORIES = [
  { id: "clock", brand: "Tempo", name: "Clock", price: 60, sales: 5 },
  { id: "tote-bag", brand: "Tempo", name: "Tote bag", price: 28, sales: 9 },
  { id: "backpack", brand: "Tempo", name: "Backpack", price: 110, sales: 4 },
  { id: "shoulder-bag", brand: "Tempo", name: "Shoulder bag", price: 90, sales: 3 },
  { id: "wallet", brand: "Tempo", name: "Wallet", price: 20, sales: 8 },
  { id: "small-crossbody", brand: "Tempo", name: "Small crossbody", price: 70, sales: 2 },
  { id: "binder", brand: "MPP", name: "Binder", price: 24, sales: 6 },
  { id: "notebook", brand: "MPP", name: "Notebook", price: 22, sales: 7 },
  { id: "pen", brand: "MPP", name: "Pen", price: 12, sales: 10 },
  { id: "mug", brand: "MPP", name: "Mug", price: 18, sales: 9 },
  { id: "keycaps", brand: "MPP", name: "Keycaps", price: 55, sales: 3 },
  { id: "metronome", brand: "MPP", name: "Metronome", price: 40, sales: 2 },
  { id: "wristwatch", brand: "Tempo", name: "Wristwatch", price: 180, sales: 1 },
  { id: "precision-spinner", brand: "MPP", name: "Precision spinner", price: 32, sales: 4 },
  { id: "bottle", brand: "MPP", name: "Bottle", price: 20, sales: 6 },
];

const FAQ_GROUPS = [
  {
    label: "Orders & Payments",
    entries: [
      {
        q: "What payment methods do you accept?",
        a: ["We accept all major credit and debit cards (Visa, Mastercard, American Express, Discover), as well as PayPal, Apple Pay, and Google Pay."],
      },
      {
        q: "Can I change or cancel my order?",
        a: ["We process orders quickly, but if you need to make a change, please contact us within 24 hours of placing your order at [insert email address]. Once an order has been shipped, we can no longer modify or cancel it."],
      },
      {
        q: "I entered the wrong shipping address. What should I do?",
        a: ["Please email us immediately at [insert email address] with your order number and the correct address. If the order hasn't shipped yet, we will gladly update it for you."],
      },
      {
        q: "machine payments protocol",
        a: ["Turn on another revenue source for your business by implementing the Machine Payments Protocol (MPP). MPP is the open protocol for machine-to-machine payments which allows businesses to charge agents for API requests, MCP servers, or access to content. All payments can be settled instantly into your Tempo wallet with no fees."],
      },
    ],
  },
  {
    label: "SHIpping and delivery",
    entries: [
      {
        q: "When will my order ship?",
        a: ["Most orders are processed and shipped within 3 to 5 business days. You will receive a confirmation email with a tracking number as soon as your package is on its way."],
      },
      {
        q: "How long does delivery take?",
        a: ["Delivery times depend on your location: Domestic (US/UK/EU): 3 to 7 business days. International: 10 to 21 business days, depending on customs."],
      },
      {
        q: "Do you ship internationally?",
        a: ["Yes, we ship worldwide! Please note that international customers are responsible for any customs fees, import duties, or taxes incurred upon delivery."],
      },
    ],
  },
  {
    label: "Returns & Exchanges",
    entries: [
      {
        q: "What is your return policy?",
        a: ["We want you to love your merch! If you are not completely satisfied, we accept returns within 30 days of delivery. Items must be unworn, unwashed, and in their original condition."],
      },
      {
        q: "How do I start a return or exchange?",
        a: ["To initiate a return or exchange, please email us at [insert email address] with your order number and the reason for the return. We will provide you with the return address and further instructions."],
      },
      {
        q: "Do you ship internationally?",
        a: ["Yes, we ship worldwide! Please note that international customers are responsible for any customs fees, import duties, or taxes incurred upon delivery."],
      },
    ],
  },
];

const ABOUT = [
  {
    h: "The payment layer for AI agents",
    p: ["Fund agent wallets, set permissions, and monetize your APIs — all with instant, low fee autonomous payments."],
  },
  {
    h: "Monetize your APIs",
    p: ["Turn on another revenue source for your business by implementing the Machine Payments Protocol (MPP). MPP is the open protocol for machine-to-machine payments which allows businesses to charge agents for API requests, MCP servers, or access to content. All payments can be settled instantly into your Tempo wallet with no fees."],
  },
  {
    h: "Give agents a wallet",
    p: ["Use Tempo Wallet or any other Tempo-compatible wallet to let your agents call APIs, buy services, and run tasks within budget. Fund it with a credit card, Apple Pay, ACH or with any fiat currency, and set limits and permissions. Or let your applications create user, agent, and team accounts on Tempo with Tempo Accounts SDK."],
  },
  {
    h: "Machine payments protocol",
    p: ["Turn on another revenue source for your business by implementing the Machine Payments Protocol (MPP). MPP is the open protocol for machine-to-machine payments which allows businesses to charge agents for API requests, MCP servers, or access to content. All payments can be settled instantly into your Tempo wallet with no fees."],
  },
  {
    h: "Connect With Us",
    p: [
      "Want to stay in the loop on our latest drops, exclusive discounts, and behind-the-scenes content? Follow us on social media and drop a comment or tag us in your merch photos!",
      "Twitter/X: @Tempo Github: @Tempo",
      "LinkedIN: @Tempo",
    ],
  },
];

const SHIPPING = [
  {
    h: "Order Processing Times",
    p: ["All orders are processed and packed within 2 to 5 business days (excluding weekends and holidays) after receiving your order confirmation email. You will receive another notification containing your tracking number once your order has shipped. Please Note: During high-volume periods, such as new product drops or the holiday season, processing times may be slightly delayed. We appreciate your patience!"],
  },
  {
    h: "Shipping Rates & Estimated Delivery",
    p: ["We offer a variety of shipping options to get your gear to you. Shipping charges for your order will be calculated and displayed at checkout, but you can use the table below as a general guide."],
  },
  {
    h: "International Shipping & Customs",
    p: ["We proudly ship worldwide! However, please be aware that your order may be subject to import duties, taxes (including VAT), and customs fees once a shipment reaches your destination country."],
  },
  {
    h: "How to Track Your Order",
    p: ["When your order ships, we will send you an email notification containing a tracking number. Please allow up to 48 hours for the tracking information to become active in the carrier's system. If you haven't received your shipping confirmation email within 5 business days of placing your order, please check your spam folder, and then contact us at [insert email address] with your name and order number."],
  },
  {
    h: "Lost, Stolen, or Damaged Packages",
    p: [
      "We do our best to ensure your items arrive safely, but once a package is handed over to the carrier, we have limited control.",
      "Damaged Items: If your order arrives damaged, please save all packaging materials and damaged goods, and email us immediately at [insert email address] with photos of the damage. We will work with you to replace the item or issue a refund. Lost or Stolen Packages: If your tracking information shows that your package was delivered but you cannot find it, please check with neighbors or your local post office. If it has been more than 3 days since the marked delivery date, reach out to us and we will do our best to assist you in filing a claim with the carrier.",
    ],
  },
];

const CONTACT = [
  {
    h: "Get in Touch",
    p: ["We always love hearing from our community! Whether you have a question about a recent order, need help with sizing, or just want to tell us how much you love your new merch, our team is here and ready to help."],
  },
  {
    h: "Customer Support",
    p: [
      "The quickest way to reach us is via email. We aim to respond to all inquiries within 1 to 2 business days.",
      "Email: support@tempomerch.com Phone: +1 (555) 987-6543 (Available during regular business hours)",
      "Tip: If you are contacting us about an existing order, please include your Order Number in the subject line of your email so we can pull up your details right away",
    ],
  },
  {
    h: "Business Hours",
    p: [
      "Our support team is online and ready to assist you during the following hours:",
      "Monday - Friday: 9:00 AM – 5:00 PM (CST) Saturday & Sunday: Closed Holidays: Closed",
      "Please note that any emails or messages sent over the weekend will be answered first thing on Monday morning.",
    ],
  },
  {
    h: "Connect With Us",
    p: [
      "Want to stay in the loop on our latest drops, exclusive discounts, and behind-the-scenes content? Follow us on social media and drop a comment or tag us in your merch photos!",
      "Twitter/X: @Tempo Github: @Tempo",
      "LinkedIN: @Tempo",
      "Before you reach out... Have you checked our FAQ or Shipping pages? We might have already answered your question!",
    ],
  },
];

/* Rail menu. `tools` marks the two catalog branches that nest Sort/Filter/Compare/Find. */
/* Every prompt sits at the same level — no branches, no sub-prompts.
   Sorting and filtering are properties of a view, so they live on the view. */
/* The six prompts the design lists. Shipping, contact and compare still exist
   and still run if typed — they just aren't in the visible list. */
/* The seven prompts, with the status each shows while it runs. */
const MENU = [
  /* One prompt for the catalog. It runs nothing itself — it opens a choice in the
     rail, and the chosen collection is what loads. */
  {
    id: "merch",
    route: "merch",
    label: "View merch",
    title: "view merch",
    owns: ["apparel", "accessories"],
    picks: {
      prompt: "Which Items would you like to see:",
      options: [
        { label: "Apparel", route: "apparel" },
        { label: "Accessories", route: "accessories" },
      ],
    },
  },
  { id: "find", route: "find", label: "Find Items", title: "Found items", loading: "querying catalog inventory..", asks: "Type:" },
  { id: "compare", route: "compare", label: "Compare", title: "compare items", loading: "comparing.." },
  { id: "faq", route: "faq", label: "List FAQ", title: "List of FAQ", loading: "querying FAQ.." },
  { id: "about", route: "about", label: "About", title: "About", loading: "querying about.." },
  { id: "cart", route: "cart", label: "View cart", title: "Cart", loading: "querying cart.." },
  { id: "checkout", route: "checkout", label: "Checkout", echo: "Start Checkout", title: "Checkout", loading: "initiating checkout.." },

  /* the two collections are reached through View merch, but still run if typed */
  { id: "apparel", route: "apparel", label: "View Apparel", title: "view apparel", loading: "querying catalog inventory..", hidden: true },
  { id: "accessories", route: "accessories", label: "View Accessories", title: "view accessories", loading: "querying catalog inventory..", hidden: true },

  { id: "shipping", route: "shipping", label: "Shipping policy", title: "shipping policy", loading: "querying shipping policy..", hidden: true },
  { id: "contact", route: "contact", label: "List contact information", title: "contact", loading: "querying contact..", hidden: true },
];

const ROUTE_TITLES = { detail: "Apparel Detail", "detail-accessories": "view accessories" };

/* Detail copy, per the frames. */
const describe = (i) =>
  `A ${i.name.toLowerCase()} for the people building the future of money. Limited edition. Once they're gone, they're gone.`;

/* The checkout form, exactly the fields the Checkout frame lists. */
const CHECKOUT_FORM = [
  { section: "Contact", fields: [[{ label: "Email" }]] },
  {
    section: "Delivery",
    fields: [
      [{ label: "Netherlands", kind: "select" }],
      [{ label: "First name" }, { label: "Second name" }],
      [{ label: "Company (optional)" }],
      [{ label: "Address" }],
      [{ label: "Apartment, suite, etc (optional)" }],
      [{ label: "Postal code" }, { label: "City" }],
      [{ label: "Phone" }],
    ],
  },
  { section: "Shipping method", note: "Enter your shipping address to view available shipping methods." },
  {
    section: "Payment",
    options: [
      {
        label: "Credit card",
        fields: [
          [{ label: "Card number" }],
          [{ label: "Expiration date (MM/YY)" }, { label: "Security code" }],
          [{ label: "Name on card" }],
        ],
        toggle: { label: "Use shipping address as billing address", choices: ["Yes", "no"] },
      },
      { label: "Apple pay" },
      { label: "Tempo" },
    ],
  },
  {
    section: "Save information for fast checkout",
    fields: [[{ label: "Mobile number (+31)" }]],
    note: "By providing your phone number, you agree to Shop's Terms and Privacy Policy.",
  },
];

/* Stage controls */
const SORTS = [
  { id: "newest", label: "NEWEST" },
  { id: "price-low", label: "PRICE:LOW" },
  { id: "price-high", label: "PRICE:HIGH" },
  { id: "best", label: "BEST SELLING" },
  { id: "alpha", label: "ALPHABETICAL" },
];

const BRANDS = ["MPP", "Tempo"];
