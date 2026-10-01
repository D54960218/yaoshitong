/** 识别成功后，后端返回给前端的药品信息结构 */
export interface Medicine {
  药名: string;
  规格: string;
  适应症: string;
  用法用量: string;
  禁忌: string;
  注意事项: string;
  /** AI 用大白话给的一句关心提醒（可能为空） */
  贴心叮嘱?: string;
  /** 注射类药的固定安全提醒：请到正规医院/诊所由医护人员注射 */
  注射提醒?: string;
  是否处方药: boolean;
  识别置信度: string;
  /** 为 true 表示信息来自按药名生成的通用说明，页面会提示"请核对药盒" */
  通用信息?: boolean;
  数据来源?: string;
}

export type RecognizeStatus = "idle" | "compressing" | "recognizing" | "done" | "error";
export type VoiceStatus = "idle" | "loading" | "playing";

/** 「继续询问」的一轮问答（发给后端的 history 只取最后 3 条） */
export interface QaTurn {
  问: string;
  答: string;
}

/** 问答面板内麦克风的子状态机（asking/answered 由发送流程覆盖） */
export type AskMicStatus = "idle" | "recording" | "recognizing";
