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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      agent_knowledge: {
        Row: {
          content: string | null
          created_at: string
          file_name: string | null
          file_path: string | null
          id: string
          title: string | null
          type: string
          user_id: string
        }
        Insert: {
          content?: string | null
          created_at?: string
          file_name?: string | null
          file_path?: string | null
          id?: string
          title?: string | null
          type?: string
          user_id: string
        }
        Update: {
          content?: string | null
          created_at?: string
          file_name?: string | null
          file_path?: string | null
          id?: string
          title?: string | null
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      agent_training_examples: {
        Row: {
          answer_file_name: string | null
          answer_file_path: string | null
          answer_text: string | null
          blueprint_file_names: string[] | null
          blueprint_file_paths: string[] | null
          created_at: string
          description: string | null
          id: string
          title: string
          user_id: string
        }
        Insert: {
          answer_file_name?: string | null
          answer_file_path?: string | null
          answer_text?: string | null
          blueprint_file_names?: string[] | null
          blueprint_file_paths?: string[] | null
          created_at?: string
          description?: string | null
          id?: string
          title: string
          user_id: string
        }
        Update: {
          answer_file_name?: string | null
          answer_file_path?: string | null
          answer_text?: string | null
          blueprint_file_names?: string[] | null
          blueprint_file_paths?: string[] | null
          created_at?: string
          description?: string | null
          id?: string
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      crm_deals: {
        Row: {
          close_date: string | null
          company_name: string | null
          crm_deal_id: string
          deal_name: string | null
          deal_value: number | null
          id: string
          metadata: Json | null
          stage: string | null
          status: string | null
          synced_at: string | null
          user_id: string
        }
        Insert: {
          close_date?: string | null
          company_name?: string | null
          crm_deal_id: string
          deal_name?: string | null
          deal_value?: number | null
          id?: string
          metadata?: Json | null
          stage?: string | null
          status?: string | null
          synced_at?: string | null
          user_id: string
        }
        Update: {
          close_date?: string | null
          company_name?: string | null
          crm_deal_id?: string
          deal_name?: string | null
          deal_value?: number | null
          id?: string
          metadata?: Json | null
          stage?: string | null
          status?: string | null
          synced_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      estimate_outcomes: {
        Row: {
          actual_cost: number | null
          actual_weight_kg: number | null
          award_status: string | null
          change_orders_total: number | null
          created_at: string | null
          crm_deal_id: string | null
          id: string
          notes: string | null
          project_id: string | null
          quoted_price: number | null
          quoted_weight_kg: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          actual_cost?: number | null
          actual_weight_kg?: number | null
          award_status?: string | null
          change_orders_total?: number | null
          created_at?: string | null
          crm_deal_id?: string | null
          id?: string
          notes?: string | null
          project_id?: string | null
          quoted_price?: number | null
          quoted_weight_kg?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          actual_cost?: number | null
          actual_weight_kg?: number | null
          award_status?: string | null
          change_orders_total?: number | null
          created_at?: string | null
          crm_deal_id?: string | null
          id?: string
          notes?: string | null
          project_id?: string | null
          quoted_price?: number | null
          quoted_weight_kg?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "estimate_outcomes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      follow_ups: {
        Row: {
          action: string
          created_at: string | null
          due_date: string | null
          id: string
          notes: string | null
          project_id: string
          status: string | null
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string | null
          due_date?: string | null
          id?: string
          notes?: string | null
          project_id: string
          status?: string | null
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string | null
          due_date?: string | null
          id?: string
          notes?: string | null
          project_id?: string
          status?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "follow_ups_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          content: string
          created_at: string
          id: string
          metadata: Json | null
          project_id: string
          role: string
          step: number | null
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          metadata?: Json | null
          project_id: string
          role: string
          step?: number | null
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          metadata?: Json | null
          project_id?: string
          role?: string
          step?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          channel: string
          created_at: string | null
          id: string
          metadata: Json | null
          notification_type: string
          project_id: string
          recipient_email: string
          recipient_name: string | null
          status: string | null
          subject: string | null
        }
        Insert: {
          body?: string | null
          channel?: string
          created_at?: string | null
          id?: string
          metadata?: Json | null
          notification_type: string
          project_id: string
          recipient_email: string
          recipient_name?: string | null
          status?: string | null
          subject?: string | null
        }
        Update: {
          body?: string | null
          channel?: string
          created_at?: string | null
          id?: string
          metadata?: Json | null
          notification_type?: string
          project_id?: string
          recipient_email?: string
          recipient_name?: string | null
          status?: string | null
          subject?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          preferred_language: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          preferred_language?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          preferred_language?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      project_files: {
        Row: {
          created_at: string
          file_name: string
          file_path: string
          file_size: number | null
          file_type: string | null
          id: string
          project_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          file_name: string
          file_path: string
          file_size?: number | null
          file_type?: string | null
          id?: string
          project_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          file_name?: string
          file_path?: string
          file_size?: number | null
          file_type?: string | null
          id?: string
          project_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_files_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          client_name: string | null
          created_at: string
          description: string | null
          deviations: string | null
          id: string
          name: string
          project_type: string | null
          scope_items: string[] | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          client_name?: string | null
          created_at?: string
          description?: string | null
          deviations?: string | null
          id?: string
          name: string
          project_type?: string | null
          scope_items?: string[] | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          client_name?: string | null
          created_at?: string
          description?: string | null
          deviations?: string | null
          id?: string
          name?: string
          project_type?: string | null
          scope_items?: string[] | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      review_comments: {
        Row: {
          author_email: string
          author_name: string
          content: string
          created_at: string
          id: string
          share_id: string
        }
        Insert: {
          author_email: string
          author_name: string
          content: string
          created_at?: string
          id?: string
          share_id: string
        }
        Update: {
          author_email?: string
          author_name?: string
          content?: string
          created_at?: string
          id?: string
          share_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "review_comments_share_id_fkey"
            columns: ["share_id"]
            isOneToOne: false
            referencedRelation: "review_shares"
            referencedColumns: ["id"]
          },
        ]
      }
      review_shares: {
        Row: {
          created_at: string
          expires_at: string | null
          id: string
          project_id: string
          review_data: Json | null
          review_type: string | null
          reviewer_email: string
          reviewer_name: string | null
          share_token: string
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          id?: string
          project_id: string
          review_data?: Json | null
          review_type?: string | null
          reviewer_email: string
          reviewer_name?: string | null
          share_token: string
          status?: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          id?: string
          project_id?: string
          review_data?: Json | null
          review_type?: string | null
          reviewer_email?: string
          reviewer_name?: string | null
          share_token?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "review_shares_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      shop_drawings: {
        Row: {
          created_at: string
          html_content: string
          id: string
          options: Json
          project_id: string
          user_id: string
          version: number
        }
        Insert: {
          created_at?: string
          html_content: string
          id?: string
          options?: Json
          project_id: string
          user_id: string
          version?: number
        }
        Update: {
          created_at?: string
          html_content?: string
          id?: string
          options?: Json
          project_id?: string
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "shop_drawings_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
