package controllers

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/go-playground/validator/v10"

	"go-peer/common"
	"go-peer/common/types"
	"go-peer/common/utils"
	"go-peer/services"
)

// PublishController handles the /publish/* endpoints.
type PublishController struct {
	service *services.PublishService // publisher state and publish loop
}

// NewPublishController returns a controller with a new publish service.
func NewPublishController() *PublishController {
	return &PublishController{
		service: services.NewPublishService(),
	}
}

// Start returns 200 when the run starts, 400 for an invalid field and 409 when
// a run is already in progress.
func (c *PublishController) Start(ctx *gin.Context) {
	var startParams types.StartParams

	// Bind the JSON payload to the struct
	if err := ctx.ShouldBindJSON(&startParams); err != nil {
		ctx.JSON(
			http.StatusBadRequest,
			utils.ErrorResponse(common.BadRequest, err, "Invalid request payload"),
		)

		return
	}

	// Validate the request params
	if err := validator.New().Struct(startParams); err != nil {
		ctx.JSON(
			http.StatusBadRequest,
			utils.ErrorResponse(common.ValidationError, err, "Invalid request params, validation failed"),
		)

		return
	}

	// Start the run
	response, err := c.service.Start(startParams)
	if err != nil {
		if errors.Is(err, common.ErrAlreadyPublishing) {
			ctx.JSON(
				http.StatusConflict,
				utils.ErrorResponse(common.AlreadyPublishing, err, "A run is already in progress"),
			)

			return
		}

		ctx.JSON(
			http.StatusBadRequest,
			utils.ErrorResponse(common.BadRequest, err, "Failed to start publishing"),
		)

		return
	}

	ctx.JSON(http.StatusOK, utils.SuccessResponse(response, "Publishing started!"))
}

// Stop ends the current run and returns the final status.
func (c *PublishController) Stop(ctx *gin.Context) {
	ctx.JSON(http.StatusOK, utils.SuccessResponse(c.service.Stop(), "Publishing stopped!"))
}

// Status returns the publisher state and counts.
func (c *PublishController) Status(ctx *gin.Context) {
	ctx.JSON(http.StatusOK, utils.SuccessResponse(c.service.Status(), "Publisher status"))
}
