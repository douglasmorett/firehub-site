"use client";

import { deleteProduct } from "@/app/actions/product";
import { Trash2 } from "lucide-react";
import { useState } from "react";

export default function DeleteProductButton({ id }: { id: string }) {
  const [loading, setLoading] = useState(false);

  const handleDelete = async () => {
    if (!confirm("Excluir este produto?")) return;
    setLoading(true);
    await deleteProduct(id);
    setLoading(false);
  };

  return (
    <button
      onClick={handleDelete}
      disabled={loading}
      className="btn btn-outline"
      style={{ color: "var(--danger)", padding: "0.5rem" }}
    >
      <Trash2 size={16} />
    </button>
  );
}
