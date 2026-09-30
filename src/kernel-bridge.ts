import type { Bindings, KernelEnvelope } from './contracts';

export async function callKernel(env: Bindings, envelope: KernelEnvelope): Promise<Response> {
  const body = JSON.stringify(envelope);
  const request = new Request('http://kernel/api/kernel/message', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

  if (env.PORTAL_KERNEL) {
    const id = env.PORTAL_KERNEL.idFromName('portal-kernel');
    const kernel = env.PORTAL_KERNEL.get(id);
    return kernel.fetch(request);
  }

  if (env.KERNEL_SERVICE) return env.KERNEL_SERVICE.fetch(request);

  if (env.KERNEL_URL) {
    const target = `${env.KERNEL_URL.replace(/\/$/, '')}/api/kernel/message`;
    return fetch(target, { method: 'POST', headers: request.headers, body });
  }

  throw new Error('Configure PORTAL_KERNEL, KERNEL_SERVICE or KERNEL_URL');
}
