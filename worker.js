import openNextWorker from "./.cf-build/.open-next/worker.js";

function bindRuntimeEnv(env) {
  globalThis.__SONGSHARE_CF_ENV = env;
}

const worker = {
  fetch(request, env, ctx) {
    bindRuntimeEnv(env);
    return openNextWorker.fetch(request, env, ctx);
  },
};

export default worker;
