package main

import (
	"fmt"

	"github.com/gin-gonic/gin"

	"go-peer/env"
	"go-peer/routers"
	"go-peer/services"
)

// main loads the settings, registers the API and starts the HTTP server.
func main() {
	err := env.LoadEnv()
	if err != nil {
		panic(err)
	}

	server := gin.Default()

	routers.Init(server)
	services.SetReady(true)

	err = server.Run(fmt.Sprintf(":%s", env.HTTPPort))
	if err != nil {
		panic(err)
	}
}
