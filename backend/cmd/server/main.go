package main

import (
	"log"
	"net/http"
	"os"

	"github.com/gitvisual/backend/internal/db"
	"github.com/gitvisual/backend/internal/git"
	"github.com/gitvisual/backend/internal/handlers"
)

func main() {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://gitvisual:gitvisual@postgres:5432/gitvisual?sslmode=disable"
	}

	database, err := db.Connect(dsn)
	if err != nil {
		log.Fatalf("DB connect: %v", err)
	}
	log.Println("Connected to database")

	// Restore active SSH key preference from DB
	var savedKey string
	database.QueryRow(`SELECT value FROM app_config WHERE key='ssh_active_key'`).Scan(&savedKey)
	if savedKey != "" {
		git.ActiveSSHKey = savedKey
		log.Printf("Active SSH key restored: %s", savedKey)
	}

	router := handlers.NewRouter(database)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	log.Printf("GitVisual API listening on :%s", port)
	if err := http.ListenAndServe(":"+port, router); err != nil {
		log.Fatalf("serve: %v", err)
	}
}
