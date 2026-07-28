"""macOS / desktop menu helpers for pywebview."""

from __future__ import annotations

from typing import Callable


def build_menu(
    *,
    on_reload: Callable[[], None] | None = None,
    on_open_data: Callable[[], None] | None = None,
    on_export: Callable[[], None] | None = None,
    on_import: Callable[[], None] | None = None,
    on_about: Callable[[], None] | None = None,
):
    """Return a pywebview Menu tree, or None if pywebview menus are unavailable."""
    try:
        from webview.menu import Menu, MenuAction, MenuSeparator
    except Exception:
        return None

    file_items = []
    if on_reload:
        file_items.append(MenuAction("刷新行情", on_reload))
    if on_export:
        file_items.append(MenuAction("导出工作区…", on_export))
    if on_import:
        file_items.append(MenuAction("导入工作区…", on_import))
    if on_open_data:
        if file_items:
            file_items.append(MenuSeparator())
        file_items.append(MenuAction("打开数据目录", on_open_data))

    help_items = []
    if on_about:
        help_items.append(MenuAction("关于 ETF Agent", on_about))

    menus = []
    if file_items:
        menus.append(Menu("文件", file_items))
    if help_items:
        menus.append(Menu("帮助", help_items))
    return menus or None
