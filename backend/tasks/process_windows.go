//go:build windows

package tasks

import (
	"os"
	"syscall"
)

const stillActiveExitCode = 259

func terminateProcess(proc *os.Process) {
	if proc != nil {
		_ = proc.Kill()
	}
}

func terminatePID(pid int) {
	if pid <= 0 {
		return
	}
	if proc, err := os.FindProcess(pid); err == nil {
		_ = proc.Kill()
	}
}

func isProcessAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	h, err := syscall.OpenProcess(syscall.PROCESS_QUERY_INFORMATION, false, uint32(pid))
	if err != nil {
		return false
	}
	defer syscall.CloseHandle(h)

	var exitCode uint32
	if err := syscall.GetExitCodeProcess(h, &exitCode); err != nil {
		return false
	}
	return exitCode == stillActiveExitCode
}
