import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from './../src/app.module';

/**
 * End-to-end tests for authorization security fixes
 * 
 * These tests verify that users can only access their own data
 * and cannot manipulate other users' data
 */
describe('Authorization Security (e2e)', () => {
  let app: INestApplication;

  // Mock JWT tokens for different users
  const user1Token = 'eyJhY2Nlc3NfdG9rZW4iOiJleUpoYkdjaU9pSklVekkxTmlJc0ltdHBaQ0k2SWxWWVJVeGpkREV3YlRsNE1qQXliRmNpTENKMGVYQWlPaUpLVjFRaWZRLmV5SnBjM01pT2lKb2RIUndjem92TDNSaWJIRjJjWEY1Ym1ScVozRnNiV2hoWm5oMUxuTjFjR0ZpWVhObExtTnZMMkYxZEdndmRqRWlMQ0p6ZFdJaU9pSmlORGhtTW1FMU1TMHlOREE1TFRRMU0ySXRPV1kxTWkxaE16RmlZelprWkRRMU16Z2lMQ0poZFdRaU9pSmhkWFJvWlc1MGFXTmhkR1ZrSWl3aVpYaHdJam94TnpZeE16ZzFNamd3TENKcFlYUWlPakUzTmpFek9ERTJPREFzSW1WdFlXbHNJam9pYjNwbGNteHBhR0Z6YUdWdFFHZHRZV2xzTG1OdmJTSXNJbkJvYjI1bElqb2lJaXdpWVhCd1gyMWxkR0ZrWVhSaElqcDdJbkJ5YjNacFpHVnlJam9pWlcxaGFXd2lMQ0p3Y205MmFXUmxjbk1pT2xzaVpXMWhhV3dpWFgwc0luVnpaWEpmYldWMFlXUmhkR0VpT25zaVpXMWhhV3dpT2lKdmVtVnliR2xvWVhOb1pXMUFaMjFoYVd3dVkyOXRJaXdpWlcxaGFXeGZkbVZ5YVdacFpXUWlPblJ5ZFdVc0luQm9iMjVsWDNabGNtbG1hV1ZrSWpwbVlXeHpaU3dpYzNWaUlqb2lZalE0WmpKaE5URXRNalF3T1MwME5UTmlMVGxtTlRJdFlUTXhZbU0yWkdRME5UTTRJbjBzSW5KdmJHVWlPaUpoZFhSb1pXNTBhV05oZEdWa0lpd2lZV0ZzSWpvaVlXRnNNU0lzSW1GdGNpSTZXM3NpYldWMGFHOWtJam9pYjNSd0lpd2lkR2x0WlhOMFlXMXdJam94TnpZeE16Z3hOamd3ZlYwc0luTmxjM05wYjI1ZmFXUWlPaUkyTWpSalpXVTVNUzFsTURsakxUUXpabVF0T0RBNU9DMDBPRFExT1RVNE0yRTJaalVpTENKcGMxOWhibTl1ZVcxdmRYTWlPbVpoYkhObGZRLlpTaDB4WHU4WkhycEV2VWQxVGc1VE5BYktzZEhrOVhPbDRGYWhQc1Nxc2siLCJ0b2tlbl90eXBlIjoiYmVhcmVyIiwiZXhwaXJlc19pbiI6MzYwMCwiZXhwaXJlc19hdCI6MTc2MTM4NTI4MCwicmVmcmVzaF90b2tlbiI6Im9wZHF3NnZ0dXcyYiIsInVzZXIiOnsiaWQiOiJiNDhmMmE1MS0yNDA5LTQ1M2ItOWY1Mi1hMzFiYzZkZDQ1MzgiLCJhdWQiOiJhdXRoZW50aWNhdGVkIiwicm9sZSI6ImF1dGhlbnRpY2F0ZWQiLCJlbWFpbCI6Im96ZXJsaWhhc2hlbUBnbWFpbC5jb20iLCJlbWFpbF9jb25maXJtZWRfYXQiOiIyMDI1LTEwLTAxVDEwOjIxOjA2LjcxMzg1MloiLCJwaG9uZSI6IiIsImNvbmZpcm1hdGlvbl9zZW50X2F0IjoiMjAyNS0xMC0wMVQxMDoyMDo0MS43MzA2NjVaIiwiY29uZmlybWVkX2F0IjoiMjAyNS0xMC0wMVQxMDoyMTowNi43MTM4NTJaIiwicmVjb3Zlcnlfc2VudF9hdCI6IjIwMjUtMTAtMjVUMDg6NDA6MDguOTQ1MDIyWiIsImxhc3Rfc2lnbl9pbl9hdCI6IjIwMjUtMTAtMjVUMDg6NDE6MTkuOTk5NDI0NDdaIiwiYXBwX21ldGFkYXRhIjp7InByb3ZpZGVyIjoiZW1haWwiLCJwcm92aWRlcnMiOlsiZW1haWwiXX0sInVzZXJfbWV0YWRhdGEiOnsiZW1haWwiOiJvemVybGloYXNoZW1AZ21haWwuY29tIiwiZW1haWxfdmVyaWZpZWQiOnRydWUsInBob25lX3ZlcmlmaWVkIjpmYWxzZSwic3ViIjoiYjQ4ZjJhNTEtMjQwOS00NTNiLTlmNTItYTMxYmM2ZGQ0NTM4In0sImlkZW50aXRpZXMiOlt7ImlkZW50aXR5X2lkIjoiNDcxNWYyYTMtM2IyNy00NTM1LTg0YmEtMDI4NzJjYWVlODk4IiwiaWQiOiJiNDhmMmE1MS0yNDA5LTQ1M2ItOWY1Mi1hMzFiYzZkZDQ1MzgiLCJ1c2VyX2lkIjoiYjQ4ZjJhNTEtMjQwOS00NTNiLTlmNTItYTMxYmM2ZGQ0NTM4IiwiaWRlbnRpdHlfZGF0YSI6eyJlbWFpbCI6Im96ZXJsaWhhc2hlbUBnbWFpbC5jb20iLCJlbWFpbF92ZXJpZmllZCI6dHJ1ZSwicGhvbmVfdmVyaWZpZWQiOmZhbHNlLCJzdWIiOiJiNDhmMmE1MS0yNDA5LTQ1M2ItOWY1Mi1hMzFiYzZkZDQ1MzgifSwicHJvdmlkZXIiOiJlbWFpbCIsImxhc3Rfc2lnbl9pbl9hdCI6IjIwMjUtMTAtMDFUMTA6MjA6NDEuNzAwMjM2WiIsImNyZWF0ZWRfYXQiOiIyMDI1LTEwLTAxVDEwOjIwOjQxLjcwMDNaIiwidXBkYXRlZF9hdCI6IjIwMjUtMTAtMDFUMTA6MjA6NDEuNzAwM1oiLCJlbWFpbCI6Im96ZXJsaWhhc2hlbUBnbWFpbC5jb20ifV0sImNyZWF0ZWRfYXQiOiIyMDI1LTEwLTAxVDEwOjIwOjQxLjY0ODM2NloiLCJ1cGRhdGVkX2F0IjoiMjAyNS0xMC0yNVQwODo0MToyMC4wMTMzNjdaIiwiaXNfYW5vbnltb3VzIjpmYWxzZX19';
  const user2Token = 'eyJhY2Nlc3NfdG9rZW4iOiJleUpoYkdjaU9pSklVekkxTmlJc0ltdHBaQ0k2SWxWWVJVeGpkREV3YlRsNE1qQXliRmNpTENKMGVYQWlPaUpLVjFRaWZRLmV5SnBjM01pT2lKb2RIUndjem92TDNSaWJIRjJjWEY1Ym1ScVozRnNiV2hoWm5oMUxuTjFjR0ZpWVhObExtTnZMMkYxZEdndmRqRWlMQ0p6ZFdJaU9pSTVNRFpqT1daa1pTMDBNRGt4TFRSaU5HTXRPRFpoWVMxbU9XUmlaRE5oTUROaU5XUWlMQ0poZFdRaU9pSmhkWFJvWlc1MGFXTmhkR1ZrSWl3aVpYaHdJam94TnpZeE16ZzJPRFF5TENKcFlYUWlPakUzTmpFek9ETXlORElzSW1WdFlXbHNJam9pWVhsdmJXbGtaV1JoZG1sa1ltRnBlV1ZBWjIxaGFXd3VZMjl0SWl3aWNHaHZibVVpT2lJaUxDSmhjSEJmYldWMFlXUmhkR0VpT25zaWNISnZkbWxrWlhJaU9pSmxiV0ZwYkNJc0luQnliM1pwWkdWeWN5STZXeUpsYldGcGJDSmRmU3dpZFhObGNsOXRaWFJoWkdGMFlTSTZleUpsYldGcGJDSTZJbUY1YjIxcFpHVmtZWFpwWkdKaGFYbGxRR2R0WVdsc0xtTnZiU0lzSW1WdFlXbHNYM1psY21sbWFXVmtJanAwY25WbExDSndhRzl1WlY5MlpYSnBabWxsWkNJNlptRnNjMlVzSW5OMVlpSTZJamt3Tm1NNVptUmxMVFF3T1RFdE5HSTBZeTA0Tm1GaExXWTVaR0prTTJFd00ySTFaQ0o5TENKeWIyeGxJam9pWVhWMGFHVnVkR2xqWVhSbFpDSXNJbUZoYkNJNkltRmhiREVpTENKaGJYSWlPbHQ3SW0xbGRHaHZaQ0k2SW05MGNDSXNJblJwYldWemRHRnRjQ0k2TVRjMk1UTTRNekkwTW4xZExDSnpaWE56YVc5dVgybGtJam9pT1dGak1HVTJNRFV0TVRVeU55MDBPRFZsTFdKaE5XTXRZVGRrTlRNM1pUZ3hNakppSWl3aWFYTmZZVzV2Ym5sdGIzVnpJanBtWVd4elpYMC43SWgyV3NVaDdOTDJJZTFmUlI4SEl1dUFLMkdNVTlFMVZMOGROT25OSC1FIiwidG9rZW5fdHlwZSI6ImJlYXJlciIsImV4cGlyZXNfaW4iOjM2MDAsImV4cGlyZXNfYXQiOjE3NjEzODY4NDIsInJlZnJlc2hfdG9rZW4iOiJia2U1b2RjN3d3b2giLCJ1c2VyIjp7ImlkIjoiOTA2YzlmZGUtNDA5MS00YjRjLTg2YWEtZjlkYmQzYTAzYjVkIiwiYXVkIjoiYXV0aGVudGljYXRlZCIsInJvbGUiOiJhdXRoZW50aWNhdGVkIiwiZW1haWwiOiJheW9taWRlZGF2aWRiYWl5ZUBnbWFpbC5jb20iLCJlbWFpbF9jb25maXJtZWRfYXQiOiIyMDI1LTEwLTIyVDA0OjU4OjI4LjU0NTE2WiIsInBob25lIjoiIiwiY29uZmlybWF0aW9uX3NlbnRfYXQiOiIyMDI1LTEwLTIyVDA0OjU4OjEzLjExODI0WiIsImNvbmZpcm1lZF9hdCI6IjIwMjUtMTAtMjJUMDQ6NTg6MjguNTQ1MTZaIiwicmVjb3Zlcnlfc2VudF9hdCI6IjIwMjUtMTAtMjVUMDk6MDY6MzMuMTgyMjA3WiIsImxhc3Rfc2lnbl9pbl9hdCI6IjIwMjUtMTAtMjVUMDk6MDc6MjIuNTAwNzQzMDRaIiwiYXBwX21ldGFkYXRhIjp7InByb3ZpZGVyIjoiZW1haWwiLCJwcm92aWRlcnMiOlsiZW1haWwiXX0sInVzZXJfbWV0YWRhdGEiOnsiZW1haWwiOiJheW9taWRlZGF2aWRiYWl5ZUBnbWFpbC5jb20iLCJlbWFpbF92ZXJpZmllZCI6dHJ1ZSwicGhvbmVfdmVyaWZpZWQiOmZhbHNlLCJzdWIiOiI5MDZjOWZkZS00MDkxLTRiNGMtODZhYS1mOWRiZDNhMDNiNWQifSwiaWRlbnRpdGllcyI6W3siaWRlbnRpdHlfaWQiOiI4YWRkYzBjZi1jZGExLTQ4NWQtYTY5Zi1mMzQ5ZTljNjJlZTYiLCJpZCI6IjkwNmM5ZmRlLTQwOTEtNGI0Yy04NmFhLWY5ZGJkM2EwM2I1ZCIsInVzZXJfaWQiOiI5MDZjOWZkZS00MDkxLTRiNGMtODZhYS1mOWRiZDNhMDNiNWQiLCJpZGVudGl0eV9kYXRhIjp7ImVtYWlsIjoiYXlvbWlkZWRhdmlkYmFpeWVAZ21haWwuY29tIiwiZW1haWxfdmVyaWZpZWQiOnRydWUsInBob25lX3ZlcmlmaWVkIjpmYWxzZSwic3ViIjoiOTA2YzlmZGUtNDA5MS00YjRjLTg2YWEtZjlkYmQzYTAzYjVkIn0sInByb3ZpZGVyIjoiZW1haWwiLCJsYXN0X3NpZ25faW5fYXQiOiIyMDI1LTEwLTIyVDA0OjU4OjEzLjExMTMzOFoiLCJjcmVhdGVkX2F0IjoiMjAyNS0xMC0yMlQwNDo1ODoxMy4xMTEzODlaIiwidXBkYXRlZF9hdCI6IjIwMjUtMTAtMjJUMDQ6NTg6MTMuMTExMzg5WiIsImVtYWlsIjoiYXlvbWlkZWRhdmlkYmFpeWVAZ21haWwuY29tIn1dLCJjcmVhdGVkX2F0IjoiMjAyNS0xMC0yMlQwNDo1ODoxMy4xMDQ2MDVaIiwidXBkYXRlZF9hdCI6IjIwMjUtMTAtMjVUMDk6MDc6MjIuNTE2Mzk1WiIsImlzX2Fub255bW91cyI6ZmFsc2V9fQ';
  
  const user1Id = 'aa17bcf4-09a6-4ded-b02b-475a7bf2a9a8';
  const user2Id = 'ae4ba3cc-7fc1-478c-a4d2-0ef830aaad59';

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Wallet Endpoints', () => {
    it('should allow user to view their own earnings', () => {
      return request(app.getHttpServer())
        .get(`/wallet/earnings/${user1Id}`)
        .set('Authorization', `Bearer ${user1Token}`)
        .expect(200);
    });

    it('should deny user from viewing another users earnings', () => {
      return request(app.getHttpServer())
        .get(`/wallet/earnings/${user2Id}`)
        .set('Authorization', `Bearer ${user1Token}`)
        .expect(403)
        .expect((res) => {
          expect(res.body.message).toContain('not authorized');
        });
    });

    it('should allow user to claim their own earnings', () => {
      return request(app.getHttpServer())
        .post('/wallet/earnings/claim')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ userId: user1Id, type: 'all' })
        .expect(200);
    });

    it('should deny user from claiming another users earnings', () => {
      return request(app.getHttpServer())
        .post('/wallet/earnings/claim')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ userId: user2Id, type: 'all' })
        .expect(403);
    });

    it('should deny user from decrypting another users private key', () => {
      return request(app.getHttpServer())
        .post('/wallet/decrypt-private-key')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ userId: user2Id })
        .expect(403);
    });
  });

  describe('Auth Endpoints', () => {
    it('should allow user to update their own XP', () => {
      return request(app.getHttpServer())
        .put(`/auth/xp/${user1Id}`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ xp: 10, title: 'Test', type: 'quiz' })
        .expect(200);
    });

    it('should deny user from updating another users XP', () => {
      return request(app.getHttpServer())
        .put(`/auth/xp/${user2Id}`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ xp: 10, title: 'Test', type: 'quiz' })
        .expect(403);
    });

    it('should allow user to view their own profile', () => {
      return request(app.getHttpServer())
        .get(`/auth/id/${user1Id}`)
        .set('Authorization', `Bearer ${user1Token}`)
        .expect(200);
    });

    it('should deny user from viewing another users profile', () => {
      return request(app.getHttpServer())
        .get(`/auth/id/${user2Id}`)
        .set('Authorization', `Bearer ${user1Token}`)
        .expect(403);
    });

    it('should deny user from deleting another users account', () => {
      return request(app.getHttpServer())
        .delete(`/auth/user/${user2Id}`)
        .set('Authorization', `Bearer ${user1Token}`)
        .query({ supabaseUserId: 'some-supabase-id' })
        .expect(403);
    });
  });

  describe('Roadmap Endpoints', () => {
    it('should allow user to generate their own roadmap', () => {
      return request(app.getHttpServer())
        .post('/roadmap/generate')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ userId: user1Id, topic: 'Test Topic' })
        .expect(200);
    });

    it('should deny user from generating roadmap for another user', () => {
      return request(app.getHttpServer())
        .post('/roadmap/generate')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ userId: user2Id, topic: 'Test Topic' })
        .expect(403);
    });

    it('should allow user to view their own roadmaps', () => {
      return request(app.getHttpServer())
        .get(`/roadmap/user/${user1Id}`)
        .set('Authorization', `Bearer ${user1Token}`)
        .expect(200);
    });

    it('should deny user from viewing another users roadmaps', () => {
      return request(app.getHttpServer())
        .get(`/roadmap/user/${user2Id}`)
        .set('Authorization', `Bearer ${user1Token}`)
        .expect(403);
    });
  });

  describe('Chat Endpoints', () => {
    it('should allow user to create their own chat', () => {
      return request(app.getHttpServer())
        .post('/chat')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ userId: user1Id, title: 'Test Chat' })
        .expect(201);
    });

    it('should deny user from creating chat for another user', () => {
      return request(app.getHttpServer())
        .post('/chat')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ userId: user2Id, title: 'Test Chat' })
        .expect(403);
    });

    it('should allow user to view their own chats', () => {
      return request(app.getHttpServer())
        .get(`/chat/user/${user1Id}`)
        .set('Authorization', `Bearer ${user1Token}`)
        .expect(200);
    });

    it('should deny user from viewing another users chats', () => {
      return request(app.getHttpServer())
        .get(`/chat/user/${user2Id}`)
        .set('Authorization', `Bearer ${user1Token}`)
        .expect(403);
    });
  });

  describe('Activity Endpoints', () => {
    it('should allow user to create their own activity', () => {
      return request(app.getHttpServer())
        .post('/activity')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ 
          userId: user1Id, 
          type: 'quiz', 
          title: 'Test Activity',
          xpEarned: 10 
        })
        .expect(201);
    });

    it('should deny user from creating activity for another user', () => {
      return request(app.getHttpServer())
        .post('/activity')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ 
          userId: user2Id, 
          type: 'quiz', 
          title: 'Test Activity',
          xpEarned: 10 
        })
        .expect(403);
    });
  });

  describe('Rewards Endpoints', () => {
    it('should allow user to claim their own reward', () => {
      return request(app.getHttpServer())
        .post('/rewards/claim')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ userId: user1Id, rewardId: 'reward-id' })
        .expect(200);
    });

    it('should deny user from claiming reward for another user', () => {
      return request(app.getHttpServer())
        .post('/rewards/claim')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ userId: user2Id, rewardId: 'reward-id' })
        .expect(403);
    });

    it('should allow user to view their own rewards', () => {
      return request(app.getHttpServer())
        .get(`/rewards/user/${user1Id}`)
        .set('Authorization', `Bearer ${user1Token}`)
        .expect(200);
    });

    it('should deny user from viewing another users rewards', () => {
      return request(app.getHttpServer())
        .get(`/rewards/user/${user2Id}`)
        .set('Authorization', `Bearer ${user1Token}`)
        .expect(403);
    });
  });

  describe('AI Endpoints', () => {
    it('should allow user to generate AI response for their own chat', () => {
      return request(app.getHttpServer())
        .post('/ai/message')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ 
          userId: user1Id, 
          chatId: 'chat-id',
          messages: [{ role: 'user', content: 'Hello' }]
        })
        .expect(200);
    });

    it('should deny user from generating AI response for another users chat', () => {
      return request(app.getHttpServer())
        .post('/ai/message')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ 
          userId: user2Id, 
          chatId: 'chat-id',
          messages: [{ role: 'user', content: 'Hello' }]
        })
        .expect(403);
    });
  });
});

