export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      batches: {
        Row: {
          created_at: string
          filename: string
          id: string
          processed_urls: number
          status: string
          total_urls: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          filename: string
          id?: string
          processed_urls?: number
          status?: string
          total_urls?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          filename?: string
          id?: string
          processed_urls?: number
          status?: string
          total_urls?: number
          updated_at?: string
        }
        Relationships: []
      }
      check_requests: {
        Row: {
          created_at: string
          id: number
          ip: string
          kind: string
        }
        Insert: {
          created_at?: string
          id?: never
          ip: string
          kind?: string
        }
        Update: {
          created_at?: string
          id?: never
          ip?: string
          kind?: string
        }
        Relationships: []
      }
      domain_history: {
        Row: {
          checked_at: string
          domain: string
          dr: number
          id: number
        }
        Insert: {
          checked_at: string
          domain: string
          dr: number
          id?: never
        }
        Update: {
          checked_at?: string
          domain?: string
          dr?: number
          id?: never
        }
        Relationships: []
      }
      domain_meta: {
        Row: {
          attempts: number
          claimed_at: string | null
          description: string | null
          domain: string
          error: string | null
          favicon_path: string | null
          fetched_at: string | null
          status: string | null
          title: string | null
        }
        Insert: {
          attempts?: number
          claimed_at?: string | null
          description?: string | null
          domain: string
          error?: string | null
          favicon_path?: string | null
          fetched_at?: string | null
          status?: string | null
          title?: string | null
        }
        Update: {
          attempts?: number
          claimed_at?: string | null
          description?: string | null
          domain?: string
          error?: string | null
          favicon_path?: string | null
          fetched_at?: string | null
          status?: string | null
          title?: string | null
        }
        Relationships: []
      }
      domains: {
        Row: {
          checked_at: string
          domain: string
          dr: number | null
          dr_change: number | null
          status: string
        }
        Insert: {
          checked_at?: string
          domain: string
          dr?: number | null
          dr_change?: number | null
          status: string
        }
        Update: {
          checked_at?: string
          domain?: string
          dr?: number | null
          dr_change?: number | null
          status?: string
        }
        Relationships: []
      }
      urls: {
        Row: {
          attempts: number
          available_at: string
          batch_id: string
          checked_at: string | null
          claimed_at: string | null
          created_at: string
          domain: string
          dr: number | null
          error_message: string | null
          id: string
          original_url: string
          source: string | null
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          available_at?: string
          batch_id: string
          checked_at?: string | null
          claimed_at?: string | null
          created_at?: string
          domain: string
          dr?: number | null
          error_message?: string | null
          id?: string
          original_url: string
          source?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          available_at?: string
          batch_id?: string
          checked_at?: string | null
          claimed_at?: string | null
          created_at?: string
          domain?: string
          dr?: number | null
          error_message?: string | null
          id?: string
          original_url?: string
          source?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "urls_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches"
            referencedColumns: ["id"]
          },
        ]
      }
      worker_lease: {
        Row: {
          expires_at: string
          holder: string | null
          id: number
        }
        Insert: {
          expires_at?: string
          holder?: string | null
          id?: number
        }
        Update: {
          expires_at?: string
          holder?: string | null
          id?: number
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      acquire_worker_lease: {
        Args: { p_holder: string; p_ttl_seconds?: number }
        Returns: boolean
      }
      claim_meta_domains: { Args: { p_limit?: number }; Returns: string[] }
      claim_pending_urls: {
        Args: { p_limit?: number }
        Returns: {
          attempts: number
          domain: string
          id: string
        }[]
      }
      domain_trends: {
        Args: { p_domains: string[]; p_n: number }
        Returns: {
          checked_at: string
          domain: string
          dr: number
        }[]
      }
      kick_meta_worker: { Args: never; Returns: undefined }
      kick_worker: { Args: never; Returns: undefined }
      meta_due: {
        Args: { p_claimed_at: string; p_fetched_at: string; p_status: string }
        Returns: boolean
      }
      register_check_request: {
        Args: { p_ip: string; p_kind?: string; p_limit?: number }
        Returns: boolean
      }
      release_worker_lease: { Args: { p_holder: string }; Returns: undefined }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
