from pywinauto import Desktop
import win32process
wins = Desktop(backend="uia").windows()
for w in wins:
    try:
        _, pid = win32process.GetWindowThreadProcessId(w.handle)
    except Exception:
        continue
    if pid == 7008:
        print(pid, repr(w.window_text())[:80], w.class_name(), w.handle)
