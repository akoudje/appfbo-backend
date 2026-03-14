const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const country = await prisma.country.findUnique({
    where: { code: "CIV" },
  });

  if (!country) {
    throw new Error("Country CIV not found");
  }

  const products = [
    {
      sku: "559",
      nom: "Forever Exfoliator",
      imageUrl:
        "https://res.cloudinary.com/dwgrotjh0/image/upload/v1772328558/appfbo/products/559.png",
      prixBaseFcfa: 16000,
      cc: "0.073",
      poidsKg: "0.065",
      actif: true,
      category: "SOINS_DE_LA_PEAU",
      details:
        "Ce soin conjugue exfoliation enzymatique et mécanique pour nettoyer la peau en profondeur. Le grain de peau est affiné et le teint unifié. \n\nCe soin allie efficacité et douceur pour vous permettre de faire peau neuve. Il conjugue exfoliation enzymatique (bromélaïne et papaïne) et mécanique (perles de jojoba et de bambou) pour désincruster les impuretés, tout en enveloppant la peau d’un voile protecteur grâce à de puissants actifs hydratants. Résultat un grain de peau affiné, une peau lisse et satinée.",
      stockQty: 100,
    },
    {
      sku: "686",
      nom: "Forerver Vitamine C",
      imageUrl:
        "https://res.cloudinary.com/dwgrotjh0/image/upload/v1772328844/appfbo/products/686.png",
      prixBaseFcfa: 42500,
      cc: "0.200",
      poidsKg: "0.032",
      actif: true,
      category: "SOINS_DE_LA_PEAU",
      details:
        "Forever Vitamin C™, sérum illuminateur, aide à raviver l’éclat de la peau. Sa formule associe 6% de vitamine C hautement stable et cliniquement testée, à l’Aloe vera et au jojoba nourrissants, pour une peau visiblement plus lumineuse, hydratée et rayonnante.",
      stockQty: 100,
    },
    {
      sku: "659",
      nom: "DX4",
      imageUrl:
        "https://res.cloudinary.com/dwgrotjh0/image/upload/v1772359655/appfbo/products/659.jpg",
      prixBaseFcfa: 115500,
      cc: "0.533",
      poidsKg: "2.000",
      actif: true,
      category: "COMBO_PACKS",
      details:
        "Le DX4™ est un programme de quatre jours qui a pour objectif de vous aider à retrouver votre bien-être intérieur grâce à une association de sept produits qui agissent en synergie.\n\nLe DX4™ est un programme de quatre jours qui a pour objectif de vous aider à retrouver votre bien-être intérieur grâce à une association de compléments alimentaires qui contribuent au bon fonctionnement du métabolisme*, à l'hydratation** et à la satiété***. Les sept produits du DX4™ agissent en synergie pour retrouver un meilleur équilibre physique et émotionnel.\n\nAu cours de ce programme, vous démarrerez votre démarche vers plus de bien-être en maintenant votre niveau d'énergie et en optimisant votre alimentation. DX4™ est conçu pour vous aider à prendre soin de votre corps et à prendre conscience de la façon dont vous mangez.\n\nIl contient :\n\n4 x pulpe d’Aloe Vera (330 mL)\n1 x Forever Plant Protein™\nForever LemonBlast™  (4 sachets)\nForever Sensatiable™ (32 comprimés à croquer)\nForever Multi Fizz™ (4 comprimés effervescents)\nForever DuoPure™ (8 comprimés)\nForever Therm Plus™ (12 comprimés)",
      stockQty: 50,
    },
    {
      sku: "71",
      nom: "Garcinia Plus",
      imageUrl:
        "https://res.cloudinary.com/dwgrotjh0/image/upload/v1771528787/appfbo/products/71.png",
      prixBaseFcfa: 26000,
      cc: "0.120",
      poidsKg: "0.051",
      actif: true,
      category: "GESTION_DE_POIDS",
      details: null,
      stockQty: 100,
    },
    {
      sku: "28",
      nom: "Forever Bright",
      imageUrl:
        "https://res.cloudinary.com/dwgrotjh0/image/upload/v1771528226/appfbo/products/28.png",
      prixBaseFcfa: 7000,
      cc: "0.032",
      poidsKg: "0.050",
      actif: true,
      category: "SOINS_PERSONNELS",
      details: null,
      stockQty: 98,
    },
    {
      sku: "61",
      nom: "Gelée Aloès - Aloe Verra Gelly",
      imageUrl:
        "https://res.cloudinary.com/dwgrotjh0/image/upload/v1772039781/appfbo/products/61.png",
      prixBaseFcfa: 16000,
      cc: "0.059",
      poidsKg: "0.100",
      actif: true,
      category: "SOINS_PERSONNELS",
      details:
        "Riche en Aloe vera, ce gel transparent non gras protège contre le dessèchement causé par le soleil, rafraîchit la peau, hydrate intensément et régénère ainsi l’épiderme. \n\nParticulièrement riche en Aloe Vera, ce gel transparent non gras possède toutes les vertus de la plante. Il hydrate, apaise et régénère l'épiderme. Il est idéal contre les irritations superficielles de la peau et les agressions extérieures.\nExtrêmement proche du précieux mucilage de la plante, il contient 84,46% de gel naturel d'Aloe vera, la gelée bénéficie de toutes ses propriétés apaisantes, réparatrices et hydratantes. Son pH 5,5 doux et équilibrant est parfaitement toléré par toutes les peaux, même les plus sensibles.",
      stockQty: 100,
    },
    {
      sku: "613",
      nom: "Forever Marine Collagene",
      imageUrl:
        "https://res.cloudinary.com/dwgrotjh0/image/upload/v1772039265/appfbo/products/613.png",
      prixBaseFcfa: 69000,
      cc: "0.327",
      poidsKg: "0.300",
      actif: true,
      category: "NUTRITION",
      details: null,
      stockQty: 100,
    },
    {
      sku: "196",
      nom: "Forever Freedom",
      imageUrl:
        "https://res.cloudinary.com/dwgrotjh0/image/upload/v1771528281/appfbo/products/196.png",
      prixBaseFcfa: 32000,
      cc: "0.146",
      poidsKg: "1.000",
      actif: true,
      category: "BUVABLE",
      details:
        "Forever Freedom est une boisson conçue pour accompagner un mode de vie actif et se réinvente avec une formule améliorée : une saveur d’agrumes naturelle aux notes fraîches de citron et d’orange, une composition sans crustacés et un format liquide pratique, idéal pour une consommation quotidienne.\n\nElle associe le gel d’aloe vera pur de Forever, extrait de la pulpe interne des feuilles, à trois ingrédients clés : le sulfate de glucosamine, le sulfate de chondroïtine et le méthylsulfonylméthane (MSM).",
      stockQty: 99,
    },
    {
      sku: "471",
      nom: "Forever Lite Ultra Chocolat",
      imageUrl:
        "https://res.cloudinary.com/dwgrotjh0/image/upload/v1772169476/appfbo/products/471.png",
      prixBaseFcfa: 26500,
      cc: "0.122",
      poidsKg: "0.375",
      actif: true,
      category: "GESTION_DE_POIDS",
      details:
        "Pour garder la ligne, cet en-cas nutritif et savoureux, peut compléter un repas léger en apportant vitamines, minéraux protéines et carbo-hydrates. Forever ultra Lite Plus Chocolat contribue au maintien de la masse musculaire et participe au rendement normal du métabolisme énergétique.",
      stockQty: 99,
    },
    {
      sku: "215",
      nom: "Forever Multi-Maca",
      imageUrl:
        "https://res.cloudinary.com/dwgrotjh0/image/upload/v1772039060/appfbo/products/215.png",
      prixBaseFcfa: 23500,
      cc: "0.107",
      poidsKg: "0.100",
      actif: true,
      category: "NUTRITION",
      details: null,
      stockQty: 96,
    },
    {
      sku: "721",
      nom: "FAB - Forever Active Boost",
      imageUrl:
        "https://res.cloudinary.com/dwgrotjh0/image/upload/v1771528289/appfbo/products/721.png",
      prixBaseFcfa: 5000,
      cc: "0.019",
      poidsKg: "0.282",
      actif: true,
      category: "BUVABLE",
      details:
        "Obtenez le coup de pouce dont vous avez besoin pour affronter la journée avec FAB Forever Active Boost, qui contient des ingrédients contribuant à réduire la fatigue et à maintenir le fonctionnement normal du système immunitaire.\nElle se consomme à tout moment de la journée pour stimuler votre énergie physique et intellectuelle que vous soyez étudiant, sportif  avant ou après un effort et à tous ceux qui ont besoin d’un coup de boost !",
      stockQty: 99,
    },
    {
      sku: "375",
      nom: "Vitolize Women",
      imageUrl:
        "https://res.cloudinary.com/dwgrotjh0/image/upload/v1771528257/appfbo/products/375.png",
      prixBaseFcfa: 26000,
      cc: "0.127",
      poidsKg: "0.100",
      actif: true,
      category: "NUTRITION",
      details: null,
      stockQty: 99,
    },
    {
      sku: "22",
      nom: "Forever Aloe Lips",
      imageUrl:
        "https://res.cloudinary.com/dwgrotjh0/image/upload/v1771528850/appfbo/products/22.png",
      prixBaseFcfa: 3500,
      cc: "0.014",
      poidsKg: "0.010",
      actif: true,
      category: "SOINS_PERSONNELS",
      details: null,
      stockQty: 100,
    },
    {
      sku: "504",
      nom: "Forever ARGI+ Sticks pack",
      imageUrl:
        "https://res.cloudinary.com/dwgrotjh0/image/upload/v1771528343/appfbo/products/504.png",
      prixBaseFcfa: 65500,
      cc: "0.303",
      poidsKg: "0.350",
      actif: true,
      category: "NUTRITION",
      details: null,
      stockQty: 98,
    },
    {
      sku: "676",
      nom: "Forever AloeTurm",
      imageUrl:
        "https://res.cloudinary.com/dwgrotjh0/image/upload/v1772325627/appfbo/products/676.png",
      prixBaseFcfa: 6000,
      cc: "0.026",
      poidsKg: "0.015",
      actif: true,
      category: "NUTRITION",
      details:
        "Tous les bienfaits du curcuma provenant d'Inde et du zinc concentrés dans une pastille hydrogel innovante à la menthe qui fond dans la bouche, pour un bien-être global au quotidien.",
      stockQty: 100,
    },
    {
      sku: "548",
      nom: "Programme C9 - Vanille",
      imageUrl:
        "https://res.cloudinary.com/dwgrotjh0/image/upload/v1772363929/appfbo/products/548.png",
      prixBaseFcfa: 104500,
      cc: "0.482",
      poidsKg: "1.500",
      actif: true,
      category: "COMBO_PACKS",
      details:
        "Le C9™ s’effectue sur 9 jours pour purifier son organisme en éliminant les toxines. Les résultats apparaissent dès les premiers jours : perte de poids, sensation de légèreté et énergie retrouvée. Existe aussi en saveur Chocolat.",
      stockQty: 50,
    },
    {
      sku: "65",
      nom: "Forever Ail et Thym",
      imageUrl:
        "https://res.cloudinary.com/dwgrotjh0/image/upload/v1772715817/appfbo/products/65.png",
      prixBaseFcfa: 16000,
      cc: "0.072",
      poidsKg: "0.040",
      actif: true,
      category: "NUTRITION",
      details:
        "Forever Ail et Thym est une association unique de 2 extraits de plantes. Capsule sans odeur.",
      stockQty: 95,
    },
    {
      sku: "716",
      nom: "Pulpe d'Aloes - 33ml",
      imageUrl:
        "https://res.cloudinary.com/dwgrotjh0/image/upload/v1772130017/appfbo/products/716.png",
      prixBaseFcfa: 7000,
      cc: "0.030",
      poidsKg: "0.350",
      actif: true,
      category: "BUVABLE",
      details:
        "Elaborée à partir de feuilles entières récoltées et décortiquées à la main, la pulpe d'Aloe vera est concentrée à 99.7%. L’Aloe vera contribue au fonctionnement normal du système immunitaire. Source d’antioxydants, il protège les cellules et tissus de l’oxydation. Grâce à sa richesse en vitamine C, cette formule contribue à réduire la fatigue et participe au maintien du métabolisme énergétique.",
      stockQty: 100,
    },
    {
      sku: "463",
      nom: "Forever Therm",
      imageUrl:
        "https://res.cloudinary.com/dwgrotjh0/image/upload/v1772039400/appfbo/products/463.png",
      prixBaseFcfa: 25000,
      cc: "0.114",
      poidsKg: "0.100",
      actif: true,
      category: "GESTION_DE_POIDS",
      details:
        "Forever Therm™ aide à maintenir et contrôler le poids ainsi que la réduction des corps gras grâce notamment au thé vert qu'il contient. \n\nLa thermogenèse est un procédé naturel de production de chaleur par l’organisme qui est activé par le métabolisme cellulaire. En stimulant le métabolisme cellulaire pour produire de la chaleur, le corps va être amené à puiser dans ses réserves de graisses stockées pour produire l'énergie nécessaire à la génération de chaleur. Ainsi, ces graisses seront éliminées et transformées en énergie.\n\nForever Therm™ est formulé à partir d'extraits de plantes (thé vert, café vert, guarana) associés à des vitamines. Le thé vert aide à maintenir et à contrôler le poids, à accroître l’oxydation des graisses et à réduire les corps gras. La caféine contenue dans le guarana aide à améliorer la concentration et la vitamine C contribue à réduire la fatigue.",
      stockQty: 100,
    },
    {
      sku: "470",
      nom: "Forever Lite Ultra Vanille",
      imageUrl:
        "https://res.cloudinary.com/dwgrotjh0/image/upload/v1772170106/appfbo/products/470.png",
      prixBaseFcfa: 26500,
      cc: "0.123",
      poidsKg: "0.375",
      actif: true,
      category: "GESTION_DE_POIDS",
      details:
        "Pour garder la ligne, cet en-cas nutritif savoureux, riche en protéines, peut compléter un repas léger en apportant vitamines, minéraux, protéines et glucides. Forever Lite Ultra™ Vanille contribue au maintien de la masse musculaire et participe au rendement normal du métabolisme énergétique.",
      stockQty: 100,
    },
    {
      sku: "207",
      nom: "Forever Bee Honey",
      imageUrl:
        "https://res.cloudinary.com/dwgrotjh0/image/upload/v1772110753/appfbo/products/207.png",
      prixBaseFcfa: 15500,
      cc: "0.070",
      poidsKg: "0.500",
      actif: true,
      category: "PRODUIT_DE_LA_RUCHE",
      details:
        "Le miel, aussi appelé “or de la ruche”, est produit par les abeilles à partir du nectar des fleurs. Forever Miel est un miel pur récolté en montagne.\n\nLe Miel Forever Bee Honey™ est un super aliment qui concentre la richesse botanique de l’environnement dont il est issu. En montagne, les abeilles tirent profit d’une nature plus préservée et moins polluée pour en faire un miel d’exception.",
      stockQty: 50,
    },
    {
      sku: "36",
      nom: "Gelée Royale Forever",
      imageUrl:
        "https://res.cloudinary.com/dwgrotjh0/image/upload/v1772171539/appfbo/products/36.png",
      prixBaseFcfa: 28500,
      cc: "0.130",
      poidsKg: "0.034",
      actif: true,
      category: "PRODUIT_DE_LA_RUCHE",
      details:
        "La gelée royale est le produit le plus précieux de la ruche. Sécrétée par les jeunes abeilles, elle transforme en quelques jours une larve en reine. \n\nLa Gelée Royale, sécrétée par les abeilles nourricières vers le 15ème jour de leur vie est exclusivement destinée à la reine des abeilles, c’est un « super-aliment ». Sa composition, encore plus riche que celle du miel, fait de Forever Royal Jelly un complément alimentaire particulièrement nutritif pour l’homme. \nIl contient plus de 100 éléments vitaux pour l’organisme. Il est riche en protéines, en vitamines dont les A, C, D et E et la majorité des vitamines B, ainsi qu’en minéraux et oligo-éléments tels que le cuivre, le soufre et le silicium.",
      stockQty: 100,
    },
    {
      sku: "520",
      nom: "Forever Fast Break Bar",
      imageUrl:
        "https://res.cloudinary.com/dwgrotjh0/image/upload/v1772170561/appfbo/products/520.png",
      prixBaseFcfa: 5000,
      cc: "0.021",
      poidsKg: "0.056",
      actif: true,
      category: "GESTION_DE_POIDS",
      details:
        "Forever Fast Break™ est une barre énergétique à la délicieuse saveur beurre de cacahuète. Source de glucides, mais aussi de vitamines et de minéraux, ce concentré de nutriments sera l’allié idéal des sportifs. En effet, sa composition unique permet une libération d’énergie en deux temps : tout d’abord immédiate puis graduelle. Effet coup de fouet assuré ! Elle sera tout aussi utile dans un sac à main ou le tiroir du bureau pour éviter les fringales et surmonter les coups de barre.",
      stockQty: 100,
    },
    {
      sku: "15",
      nom: "Pulpe - Aloe Vera Gel - 1L",
      imageUrl:
        "https://res.cloudinary.com/dwgrotjh0/image/upload/v1771528237/appfbo/products/15.png",
      prixBaseFcfa: 22000,
      cc: "0.100",
      poidsKg: "1.000",
      actif: true,
      category: "BUVABLE",
      details:
        "Elaborée à partir de feuilles entières récoltées et décortiquées à la main, la pulpe d'Aloe vera est concentrée à 99.7%. L’Aloe vera contribue au fonctionnement normal du système immunitaire. Source d’antioxydants, il protège les cellules et tissus de l’oxydation. Grâce à sa richesse en vitamine C, cette formule contribue à réduire la fatigue et participe au maintien du métabolisme énergétique.",
      stockQty: 100,
    },
    {
      sku: "564",
      nom: "Aloe Heat Lotion",
      imageUrl:
        "https://res.cloudinary.com/dwgrotjh0/image/upload/v1771528857/appfbo/products/564.png",
      prixBaseFcfa: 13000,
      cc: "0.060",
      poidsKg: "0.030",
      actif: true,
      category: "SOINS_PERSONNELS",
      details: null,
      stockQty: 48,
    },
    {
      sku: "27",
      nom: "Forever Bee Propolis",
      imageUrl:
        "https://res.cloudinary.com/dwgrotjh0/image/upload/v1772171263/appfbo/products/27.png",
      prixBaseFcfa: 28480,
      cc: "0.130",
      poidsKg: "0.043",
      actif: true,
      category: "PRODUIT_DE_LA_RUCHE",
      details:
        "La propolis est une résine collectée et métabolisée par les abeilles mellifères à partir des arbres et utilisée pour protéger la ruche.",
      stockQty: 100,
    },
    {
      sku: "26",
      nom: "Forever Bee Pollen",
      imageUrl:
        "https://res.cloudinary.com/dwgrotjh0/image/upload/v1772171817/appfbo/products/26.png",
      prixBaseFcfa: 13000,
      cc: "0.060",
      poidsKg: "0.060",
      actif: true,
      category: "PRODUIT_DE_LA_RUCHE",
      details:
        "Collecté sur les fleurs par les abeilles, le pollen améliore leur vitalité et leur résistance tout au long de leurs vies.\n\nForever Bee Pollen contient du pollen d'abeille pur et du miel pour une combinaison idéale provenant directement de la ruche ! Le pollen est considéré comme l'aliment le plus complet de la nature. \n\nEn volant de fleur en fleur, les abeilles pollinisent les plantes et alimentent notre écosystème. Elles utilisent le pollen qu'elles récoltent pour créer leur nourriture, ce qui maintient toute la ruche nourrie, productive et forte. Le pollen améliore leur vitalité et leur résistance.",
      stockQty: 100,
    },
    {
      sku: "459",
      nom: "Vital-5 Freedom",
      imageUrl:
        "https://res.cloudinary.com/dwgrotjh0/image/upload/v1772363711/appfbo/products/459.png",
      prixBaseFcfa: 262000,
      cc: "1.209",
      poidsKg: "1.500",
      actif: true,
      category: "COMBO_PACKS",
      details:
        "Vital5™ contient les 5 produits essentiels de Forever pour garantir un bien-être au quotidien. Les actifs de ces produits agissent en synergie pour rétablir l’équilibre de la flore intestinale. Ainsi l’absorption des nutriments est optimisée ainsi que l’élimination des toxines.",
      stockQty: 50,
    },
    {
      sku: "376",
      nom: "Forever Artic Sea",
      imageUrl:
        "https://res.cloudinary.com/dwgrotjh0/image/upload/v1772715349/appfbo/products/376.png",
      prixBaseFcfa: 26000,
      cc: "0.120",
      poidsKg: "0.080",
      actif: true,
      category: "NUTRITION",
      details:
        "Forever Arctic-Sea™ contient des acides gras insaturés, des oméga-3. Le DHA contribue au fonctionnement normal du cerveau et aide à maintenir une vision normale. L'EPA et DHA contribuent à une fonction normale du coeur.",
      stockQty: 90,
    },
    {
      sku: "34",
      nom: "Aloe Berry Nectar",
      imageUrl:
        "https://res.cloudinary.com/dwgrotjh0/image/upload/v1771528087/appfbo/products/34.png",
      prixBaseFcfa: 22000,
      cc: "0.100",
      poidsKg: "1.000",
      actif: true,
      category: "BUVABLE",
      details:
        "Nouvelle bouteille PET 100% recyclable !\nUne dose généreuse d’Aloe vera et un soupçon de jus de pomme et de canneberge est l’alliance idéale. L’Aloe vera aide à stimuler le métabolisme. Riche en vitamine C, cette formule apporte une dose synergique d’antioxydants favorisant la protection des cellules contre le stress oxydatif.\n\nUne large dose (90,7%) de pulpe d'Aloe vera, un soupçon de jus de pomme et de canneberge, de la vitamine C, aucun conservateur et un emballage 100% recyclable. Et voilà le secret de la toute nouvelle formule de l'Aloe Berry Nectar. Retrouvez notre Aloe vera au coeur d'une formule au goût acidulé, pour un plaisir sain et toujours autant de bien-être.",
      stockQty: 95,
    },
    {
      sku: "289",
      nom: "Forever Lean",
      imageUrl:
        "https://res.cloudinary.com/dwgrotjh0/image/upload/v1771528813/appfbo/products/289.png",
      prixBaseFcfa: 36500,
      cc: "0.167",
      poidsKg: "0.050",
      actif: true,
      category: "GESTION_DE_POIDS",
      details:
        "Forever Lean™ est un complément alimentaire à base de feuilles de Neopuntia, de graines de haricot sec et de chrome. Le chrome qui contribue à maintenir un taux normal de glucose sanguin et participe au métabolisme normal des macronutriments.",
      stockQty: 99,
    },
    {
      sku: "374",
      nom: "Vitolize Men",
      imageUrl:
        "https://res.cloudinary.com/dwgrotjh0/image/upload/v1771528266/appfbo/products/374.png",
      prixBaseFcfa: 26000,
      cc: "0.120",
      poidsKg: "0.100",
      actif: true,
      category: "NUTRITION",
      details:
        "Vitolize Hommes contient des vitamines et des minéraux, ainsi que des phytostérols issus de l’huile de pépins de courge pour conserver un bon fonctionnement de la prostate. Le zinc présent dans Vitolize Hommes contribue au maintien normal de la fertilité, de la reproduction et du taux de testostérone dans le sang. La vitamine B6 qu’il renferme permet de réguler l’activité hormonale et le sélénium favorise une spermatogénèse normale.",
      stockQty: 96,
    },
    {
      sku: "77",
      nom: "Coeur d'Aloes",
      imageUrl:
        "https://res.cloudinary.com/dwgrotjh0/image/upload/v1772129807/appfbo/products/77.png",
      prixBaseFcfa: 22000,
      cc: "0.100",
      poidsKg: "1.000",
      actif: true,
      category: "BUVABLE",
      details:
        "La nouvelle formule de l'Aloe Pêche associe de l'Aloe vera (84,5%), de la purée de pêche et du jus concentré de raisin blanc pour une saveur douce et savoureuse, ainsi qu'une dose synergique de vitamine C. Le packaging, quant à lui, est 100% recyclable. Retrouvez la toute nouvelle version de l'Aloe Pêche pour une pause saine et gourmande !",
      stockQty: 88,
    },
    {
      sku: "284",
      nom: "Aloe Avocado Face & Body Soap",
      imageUrl:
        "https://res.cloudinary.com/dwgrotjh0/image/upload/v1771528130/appfbo/products/284.png",
      prixBaseFcfa: 6500,
      cc: "0.027",
      poidsKg: "0.100",
      actif: true,
      category: "SOINS_PERSONNELS",
      details:
        "Enrichi en ingrédients naturels comme l’huile d’avocat pur et l’Aloe vera, le savon Visage et Corps Aloe Avocado nettoie et hydrate la peau en la laissant plus lisse, plus douce et plus éclatante.",
      stockQty: 48,
    },
    {
      sku: "48",
      nom: "Absorbent-C",
      imageUrl:
        "https://res.cloudinary.com/dwgrotjh0/image/upload/v1771528079/appfbo/products/48.png",
      prixBaseFcfa: 15000,
      cc: "0.069",
      poidsKg: "0.100",
      actif: true,
      category: "NUTRITION",
      details:
        "La vitamine C contribue à réduire la fatigue et permet de retrouver tonus et énergie. Elle est indispensable pour renforcer la résistance de l’organisme.",
      stockQty: 87,
    },
  ];

  for (const p of products) {
    await prisma.product.upsert({
      where: { sku: p.sku },
      update: {
        nom: p.nom,
        imageUrl: p.imageUrl,
        prixBaseFcfa: p.prixBaseFcfa,
        cc: p.cc,
        poidsKg: p.poidsKg,
        actif: p.actif,
        category: p.category,
        details: p.details,
        stockQty: p.stockQty,
        countryId: country.id,
      },
      create: {
        sku: p.sku,
        nom: p.nom,
        imageUrl: p.imageUrl,
        prixBaseFcfa: p.prixBaseFcfa,
        cc: p.cc,
        poidsKg: p.poidsKg,
        actif: p.actif,
        category: p.category,
        details: p.details,
        stockQty: p.stockQty,
        countryId: country.id,
      },
    });
  }

  console.log(`Seed products OK (${products.length})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });