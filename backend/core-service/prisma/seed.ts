import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface TierData {
  name: string;
  price: number;
  startingBalance: number;
  maxDrawdown: number;
  minTrades: number;
  maxRiskPerTrade: number;
  profitSplit: number;
}

async function main() {
  console.log('Seeding tiers...');

  const tiers: TierData[] = [
    {
      name: 'Starter',
      price: 9900, // $99 in cents
      startingBalance: 50000,
      maxDrawdown: 0.05,
      minTrades: 30,
      maxRiskPerTrade: 0.02,
      profitSplit: 0.8,
    },
    {
      name: 'Professional',
      price: 19900, // $199 in cents
      startingBalance: 100000,
      maxDrawdown: 0.075,
      minTrades: 25,
      maxRiskPerTrade: 0.03,
      profitSplit: 0.85,
    },
    {
      name: 'Advanced',
      price: 29900, // $299 in cents
      startingBalance: 150000,
      maxDrawdown: 0.1,
      minTrades: 20,
      maxRiskPerTrade: 0.035,
      profitSplit: 0.87,
    },
    {
      name: 'Elite',
      price: 49900, // $499 in cents
      startingBalance: 200000,
      maxDrawdown: 0.1,
      minTrades: 15,
      maxRiskPerTrade: 0.04,
      profitSplit: 0.9,
    },
  ];

  for (const tier of tiers) {
    const existing = await prisma.tier.findFirst({
      where: { name: tier.name },
    });

    if (!existing) {
      await prisma.tier.create({
        data: tier,
      });
      console.log(`Created tier: ${tier.name}`);
    } else {
      console.log(`Tier already exists: ${tier.name}`);
    }
  }

  console.log('Seeding completed');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
