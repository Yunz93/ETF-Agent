#!/usr/bin/env python3
"""API credential access without persisting secrets in StockAgent config."""

from __future__ import annotations

import os
import subprocess
import sys

SERVICE = "com.bxyz.stockagent.ai"
ENV_NAMES = {
    "deepseek": "DEEPSEEK_API_KEY",
    "openai": "OPENAI_API_KEY",
}


def _provider_name(provider):
    name = str(provider or "").strip().lower()
    if name not in ENV_NAMES:
        raise ValueError("不支持的大模型提供商")
    return name


def _keychain_read(provider):
    if sys.platform != "darwin":
        return None
    result = subprocess.run(
        ["security", "find-generic-password", "-w", "-s", SERVICE, "-a", provider],
        capture_output=True,
        text=True,
        check=False,
    )
    return result.stdout.strip() if result.returncode == 0 else None


def get_api_key(provider):
    name = _provider_name(provider)
    value = os.environ.get(ENV_NAMES[name], "").strip()
    return value or _keychain_read(name)


def credential_status(provider):
    name = _provider_name(provider)
    if os.environ.get(ENV_NAMES[name], "").strip():
        return {"configured": True, "source": "environment"}
    keychain_value = _keychain_read(name)
    return {
        "configured": bool(keychain_value),
        "source": "keychain" if keychain_value else None,
    }


def save_api_key(provider, api_key):
    name = _provider_name(provider)
    value = str(api_key or "").strip()
    if len(value) < 10:
        raise ValueError("API Key 格式无效")
    if sys.platform != "darwin":
        raise RuntimeError(f"当前系统请使用环境变量 {ENV_NAMES[name]} 配置密钥")
    result = subprocess.run(
        [
            "security",
            "add-generic-password",
            "-U",
            "-s",
            SERVICE,
            "-a",
            name,
            "-w",
            value,
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError("无法写入 macOS 钥匙串")
    return credential_status(name)


def delete_api_key(provider):
    name = _provider_name(provider)
    if sys.platform == "darwin":
        subprocess.run(
            ["security", "delete-generic-password", "-s", SERVICE, "-a", name],
            capture_output=True,
            text=True,
            check=False,
        )
    return credential_status(name)
