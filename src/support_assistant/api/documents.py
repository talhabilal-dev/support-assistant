"""Document upload and management endpoints."""

from __future__ import annotations

from typing import Annotated
from uuid import UUID, uuid4

from fastapi import APIRouter, File, HTTPException, UploadFile, status

from ..ingestion.loaders import is_supported
from ..schemas import DocumentListOut, DocumentOut
from .deps import QueueDep, RepositoryDep, SettingsDep

router = APIRouter(prefix="/api/documents", tags=["documents"])


@router.post("", response_model=DocumentOut, status_code=status.HTTP_201_CREATED)
async def upload_document(
    file: Annotated[UploadFile, File()],
    settings: SettingsDep,
    repository: RepositoryDep,
    queue: QueueDep,
) -> DocumentOut:
    """Upload a document and queue it for background ingestion."""
    filename = file.filename or "upload"
    if not is_supported(filename, file.content_type):
        raise HTTPException(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            "Unsupported file type. Upload a PDF, TXT or Markdown file.",
        )

    data = await file.read()
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The uploaded file is empty.")
    if len(data) > settings.max_upload_bytes:
        raise HTTPException(
            status.HTTP_413_CONTENT_TOO_LARGE,
            f"File is larger than the {settings.max_upload_bytes} byte limit.",
        )

    document_id = uuid4()
    document = await repository.create_document(
        document_id, filename, file.content_type, data
    )
    await queue.enqueue_ingestion(document_id)
    return DocumentOut.model_validate(document)


@router.get("", response_model=DocumentListOut)
async def list_documents(repository: RepositoryDep) -> DocumentListOut:
    documents = await repository.list_documents()
    return DocumentListOut(
        documents=[DocumentOut.model_validate(document) for document in documents]
    )


@router.get("/{document_id}", response_model=DocumentOut)
async def get_document(document_id: UUID, repository: RepositoryDep) -> DocumentOut:
    document = await repository.get_document(document_id)
    if document is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found.")
    return DocumentOut.model_validate(document)


@router.delete("/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_document(document_id: UUID, repository: RepositoryDep) -> None:
    if not await repository.delete_document(document_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found.")
