//go:build !windows

package tasks

import (
	"errors"
	"os"
	"syscall"
)

func terminateProcess(proc *os.Process) {
	if proc != nil {
		_ = proc.Signal(syscall.SIGTERM)
	}
}

func terminatePID(pid int) {
	if pid > 0 {
		_ = syscall.Kill(pid, syscall.SIGTERM)
	}
}

func isProcessAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	err := syscall.Kill(pid, 0)
	return err == nil || errors.Is(err, syscall.EPERM)
}
