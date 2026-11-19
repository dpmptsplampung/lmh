import { kirimMinat } from './server';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  return kirimMinat(request, 'ipro');
}
