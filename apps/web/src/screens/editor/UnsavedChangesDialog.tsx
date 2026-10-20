import { Modal } from '../../components/Modal';

interface UnsavedChangesDialogProps {
  open: boolean;
  recipeName: string;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}

export function UnsavedChangesDialog({ open, recipeName, onSave, onDiscard, onCancel }: UnsavedChangesDialogProps) {
  return (
    <Modal
      open={open}
      title="Save changes first?"
      onClose={onCancel}
      size="small"
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn btn-danger-ghost" onClick={onDiscard}>
            Discard changes
          </button>
          <button type="button" className="btn btn-primary" onClick={onSave}>
            Save
          </button>
        </>
      }
    >
      <p>
        “{recipeName}” has unsaved changes. Save them before opening something else, or discard them. Discarded changes cannot be recovered.
      </p>
    </Modal>
  );
}
