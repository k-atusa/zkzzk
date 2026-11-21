package main

import (
	"context"
	"embed"
	"errors"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/k-atusa/zkzzk/backend/config"
	"github.com/k-atusa/zkzzk/backend/db"
	"github.com/k-atusa/zkzzk/backend/server"
)

//go:embed public
var embeddedFrontend embed.FS

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}

	if err := os.MkdirAll(cfg.DownloadsDir, 0755); err != nil {
		log.Fatalf("Failed to ensure downloads dir %s: %v", cfg.DownloadsDir, err)
	}

	store, err := db.Open(cfg.DatabasePath)
	if err != nil {
		log.Fatalf("Failed to initialize database (%s): %v", cfg.DatabasePath, err)
	}
	defer store.Close()

	distFS, err := fs.Sub(embeddedFrontend, "public")
	if err != nil {
		log.Fatalf("Failed to mount embedded frontend assets: %v", err)
	}

	app := server.NewApp(cfg, store, distFS)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	app.StartBackgroundTasks(ctx)

	httpSrv := &http.Server{
		Addr:    ":" + cfg.Port,
		Handler: app.Handler,
	}

	go func() {
		log.Printf("ZKZZK v%s listening on http://localhost:%s (db: %s, downloads: %s)",
			config.AppVersion, cfg.Port, cfg.DatabasePath, cfg.DownloadsDir)
		if err := httpSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("HTTP server error: %v", err)
		}
	}()

	<-ctx.Done()
	log.Println("Shutting down ZKZZK server...")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := httpSrv.Shutdown(shutdownCtx); err != nil {
		log.Printf("HTTP server shutdown error: %v", err)
	}
}
