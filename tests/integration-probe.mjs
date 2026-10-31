// 仅在隔离的测试 profile 中加载；不发起模型请求。
export const inject = ['commands', 'tools', 'systemPrompt'];
export function apply(ctx) {
  ctx.commands.register({ name: 'nekobot-probe', recordInput: false, description: 'Isolated integration probe', handler: async ({ agent, rawInput }) => {
    const input = JSON.parse(rawInput);
    if (input.action === 'prompt') {
      const assembly = await agent.ctx.systemPrompt.assemble({ scope: agent });
      return { kind: 'success', text: JSON.stringify({ sections: assembly.sections, tools: assembly.tools }) };
    }
    if (input.action === 'tools') {
      return { kind: 'success', text: JSON.stringify(ctx.tools.schemas(agent)) };
    }
    if (input.action === 'tool') {
      const name = input.name || 'nekobot_library';
      const tool = ctx.tools.get(name, agent);
      if (!tool) return { kind: 'error', text: 'Missing tool ' + name };
      const value = await tool.execute(input.value, { agent, signal: new AbortController().signal });
      return { kind: 'success', text: JSON.stringify(value) };
    }
    return { kind: 'error', text: 'Unknown probe' };
  } });
}
