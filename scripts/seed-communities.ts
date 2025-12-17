import db from '../drizzle';
import { community } from '../lib/db/schema';
import { eq } from 'drizzle-orm';

const communitiesData = [
  {
    title: 'Python Developers',
    inviteCode: 'PYDEV123',
    visibility: 'public' as const,
    imageUrl: 'https://s2.coinmarketcap.com/static/img/coins/200x200/5426.png',
  },
  {
    title: 'Web3 Developers',
    inviteCode: 'WEB3LEARN',
    visibility: 'public' as const,
    imageUrl: 'https://s2.coinmarketcap.com/static/img/coins/200x200/1027.png',
  },
  {
    title: 'AI & ML Developers',
    inviteCode: 'AIML2024',
    visibility: 'public' as const,
    imageUrl: 'https://s2.coinmarketcap.com/static/img/coins/200x200/3408.png',
  },
  {
    title: 'Game Developers',
    inviteCode: 'GAMEDEV01',
    visibility: 'private' as const,
    imageUrl: 'https://s2.coinmarketcap.com/static/img/coins/200x200/1831.png',
  },
  {
    title: 'Mobile Developers',
    inviteCode: 'MOBILE99',
    visibility: 'public' as const,
    imageUrl: 'https://s2.coinmarketcap.com/static/img/coins/200x200/2010.png',
  },
];

async function seedCommunities() {
  try {
    console.log('🌱 Starting community seed process...\n');

    for (const communityData of communitiesData) {
      console.log(`Checking if community "${communityData.title}" already exists...`);
      
      const existing = await db
        .select()
        .from(community)
        .where(eq(community.inviteCode, communityData.inviteCode))
        .limit(1);

      if (existing.length > 0) {
        console.log(`✅ Community "${communityData.title}" already exists (ID: ${existing[0].id})`);
        console.log(`   Invite Code: ${existing[0].inviteCode}`);
        console.log(`   Visibility: ${existing[0].visibility}\n`);
        continue;
      }

      console.log(`Creating community "${communityData.title}"...`);
      
      const [newCommunity] = await db
        .insert(community)
        .values(communityData)
        .returning();

      console.log(`✅ Community "${communityData.title}" created successfully!`);
      console.log(`   ID: ${newCommunity.id}`);
      console.log(`   Invite Code: ${newCommunity.inviteCode}`);
      console.log(`   Visibility: ${newCommunity.visibility}`);
      console.log(`   Image URL: ${newCommunity.imageUrl}\n`);
    }

    console.log('🎉 Community seed process completed!\n');
    console.log('Summary:');
    console.log('========');
    communitiesData.forEach((c) => {
      console.log(`- ${c.title} (${c.inviteCode}) - ${c.visibility}`);
    });

  } catch (error) {
    console.error('❌ Error seeding communities:', error);
    throw error;
  }
}

seedCommunities()
  .then(() => {
    console.log('\n✅ Done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Failed:', error);
    process.exit(1);
  });

