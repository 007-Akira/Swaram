"use client";

import { useCallback, useEffect, useState } from "react";

export type PracticeCapabilityIssue =
  | "insecure_context"
  | "microphone_api_unavailable"
  | "microphone_permission_denied"
  | "no_input_device"
  | "audio_worklet_unavailable"
  | "audio_context_unavailable"
  | "audio_decoding_unavailable"
  | "canvas_unavailable"
  | "unknown";

export interface PracticeCapabilities {
  checking: boolean;
  supported: boolean;
  issues: PracticeCapabilityIssue[];
}

export function detectPracticeCapabilities(): PracticeCapabilityIssue[] {
  const issues: PracticeCapabilityIssue[] = [];
  if (!window.isSecureContext && window.location.hostname !== "localhost") {
    issues.push("insecure_context");
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    issues.push("microphone_api_unavailable");
  }
  const AudioContextClass = window.AudioContext;
  if (!AudioContextClass) {
    issues.push("audio_context_unavailable");
  } else {
    if (!("audioWorklet" in AudioContextClass.prototype)) {
      issues.push("audio_worklet_unavailable");
    }
    if (!("decodeAudioData" in AudioContextClass.prototype)) {
      issues.push("audio_decoding_unavailable");
    }
  }
  const canvas = document.createElement("canvas");
  if (!canvas.getContext) issues.push("canvas_unavailable");
  return issues;
}

export function usePracticeCapabilities() {
  const [revision, setRevision] = useState(0);
  const [capabilities, setCapabilities] = useState<PracticeCapabilities>({
    checking: true,
    supported: false,
    issues: [],
  });
  useEffect(() => {
    queueMicrotask(() => {
      const issues = detectPracticeCapabilities();
      setCapabilities({
        checking: false,
        supported: issues.length === 0,
        issues,
      });
    });
  }, [revision]);
  const retry = useCallback(() => {
    setCapabilities((current) => ({ ...current, checking: true }));
    setRevision((value) => value + 1);
  }, []);
  const reportIssue = useCallback((issue: PracticeCapabilityIssue) => {
    setCapabilities({ checking: false, supported: false, issues: [issue] });
  }, []);
  return { ...capabilities, retry, reportIssue };
}
