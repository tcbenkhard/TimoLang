.PHONY: dev-api test lint typecheck

dev-api:
	uvicorn orchestrator.main:app --app-dir backend --reload

test:
	pytest

lint:
	ruff check backend

typecheck:
	mypy

