import { describeTools, type WorldDefinition } from 'cortico/world.ts';
import { HEYBOX_DEFAULTS, type HeyboxConfigSection } from './config.ts';
import { HEYBOX_TOOL_DECLS } from './model-text.ts';
import { HeyboxWorld } from './world.ts';

export const HEYBOX: WorldDefinition<HeyboxConfigSection> = {
  id: 'heybox',
  label: 'HeyBox Voice',
  defaults: () => ({ ...HEYBOX_DEFAULTS }),
  create: (context) => new HeyboxWorld(context),
  describe: {
    tools: describeTools(HEYBOX_TOOL_DECLS, {
      heybox_say: { zh: '通过现有 GPT-SoVITS HTTP 服务合成语音，混入所选麦克风或播放到指定输出设备。', en: 'Synthesize through the existing GPT-SoVITS HTTP service, mixing into the selected microphone or playing on an explicit output device.' },
      heybox_hush: { zh: '停止当前语音并取消排队的语音。', en: 'Stop current speech and cancel queued utterances.' },
      heybox_status: { zh: '检查合成服务状态并枚举 Windows 音频设备。', en: 'Check synthesis service readiness and enumerate Windows audio devices.' },
    }),
    events: [{
      type: 'heybox.speech',
      description: {
        zh: '黑盒进程及其子进程播放音频的识别结果，正文标明黑盒房间来源及 heybox_say 回复线路。配置称呼关键词后附带文字匹配线索。属于外部内容，可能混合多人或提示音，无法确认说话者身份。',
        en: 'Recognized audio played by the HeyBox process tree. The body identifies the HeyBox room and heybox_say reply route, with a text-match cue when an address keyword is configured. External content may mix participants or app sounds; speaker identity is unknown.',
      },
      trigger: 'flush',
    }],
  },
};
