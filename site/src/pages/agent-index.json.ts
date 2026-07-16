import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';

export const GET: APIRoute = async () => {
  const guides = (await getCollection('developers')).sort((a, b) => a.data.order - b.data.order);
  const chapters = guides.map((guide) => {
    const text = 'body' in guide && typeof guide.body === 'string'
      ? guide.body
      : guide.data.description;
    return {
      slug: guide.id,
      title: guide.data.title,
      part: guide.data.part,
      excerpt: guide.data.description,
      text,
      url: `/developers/${guide.id}/`,
    };
  });
  return new Response(JSON.stringify(chapters), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};
