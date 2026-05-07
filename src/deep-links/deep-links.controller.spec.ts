import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { DeepLinksModule } from './deep-links.module';

describe('DeepLinksController', () => {
  let app: NestFastifyApplication;
  const hostHeader = { Host: 'mobile.edulearn.fun' };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [DeepLinksModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves apple app site association json', async () => {
    const res = await request(app.getHttpServer())
      .get('/.well-known/apple-app-site-association')
      .set(hostHeader)
      .expect(200);

    expect(res.headers['content-type']).toContain('application/json');
    expect(res.body).toMatchObject({
      applinks: {
        apps: [],
      },
    });
    expect(res.body.applinks.details[0].paths).toEqual(
      expect.arrayContaining(['/ref/*', '/quizzes/*', '/community/*']),
    );
  });

  it('serves android asset links json', async () => {
    const res = await request(app.getHttpServer())
      .get('/.well-known/assetlinks.json')
      .set(hostHeader)
      .expect(200);

    expect(res.headers['content-type']).toContain('application/json');
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0]).toMatchObject({
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
      },
    });
  });

  it('serves referral landing html with deep-link and install fallback', async () => {
    const res = await request(app.getHttpServer())
      .get('/ref/abc123')
      .set(hostHeader)
      .expect(200);

    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('Join EduLearn with a referral');
    expect(res.text).toContain('edulearnv2://ref/ABC123');
    expect(res.text).toContain('id="open-app"');
    expect(res.text).toContain('id="install-app"');
  });

  it('serves quiz and community landing pages', async () => {
    const quiz = await request(app.getHttpServer())
      .get('/quizzes/quizref1234')
      .set(hostHeader)
      .expect(200);
    expect(quiz.text).toContain('edulearnv2://quizzes/quizref1234');

    const community = await request(app.getHttpServer())
      .get('/community/Invite77')
      .set(hostHeader)
      .expect(200);
    expect(community.text).toContain('edulearnv2://community/INVITE77');
  });

  it('returns 404 for invalid deep-link params without app-open script', async () => {
    const res = await request(app.getHttpServer())
      .get('/community/abc-123')
      .set(hostHeader);
    expect(res.status).toBe(404);
    expect(res.text).not.toContain('window.location.href = deepLinkUrl');
  });

  it('does not serve deep-link routes on non-mobile host', async () => {
    await request(app.getHttpServer()).get('/ref/abc123').expect(404);
  });
});
